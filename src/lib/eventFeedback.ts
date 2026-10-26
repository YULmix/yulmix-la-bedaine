import type { SupabaseClient } from '@supabase/supabase-js';
import fr from '../locales/fr.json';
import { appError, dbErrorMessage } from './dbErrors';
import type { ErrorLike } from './dbErrors';
import type { Database } from './database.types';
import { eventClock, fromEventLocal, toInstant } from './eventTime';
import type { InstantLike } from './eventTime';

// The member's post-mortem, « bilan » (#316), over the database's my_event_feedback() and
// submit_event_feedback() (#315, #354, ADR 0029). The database decides everything: the window (its
// state and dates come from my_event_feedback(), never computed here), eligibility, « Voir comme »
// hiding the items. This module only reads its items into a page state.
//
// A retour is a set of items (#354): one text per category, signed or private, at most one of each
// kind per category. A save sends the member's whole set; a pair left out is deleted.
//
// Privacy (ADR 0029): a private item must not be linkable to its author, on the device either.
// Nothing here stores, logs or sends an item anywhere but to submit_event_feedback(): the page
// keeps its unsaved text in React state only, and an error is logged without it.

/** The categories, in display order: the database's category values. */
export const FEEDBACK_CATEGORIES = ['welcome', 'party_music', 'safety', 'lodging', 'food', 'communications', 'schedule', 'other'] as const;
export type FeedbackCategory = typeof FEEDBACK_CATEGORIES[number];

const CATEGORY_LABEL_KEYS: Record<FeedbackCategory, keyof typeof fr> = {
  welcome: 'bilanCategoryWelcome',
  party_music: 'bilanCategoryPartyMusic',
  safety: 'bilanCategorySafety',
  lodging: 'bilanCategoryLodging',
  food: 'bilanCategoryFood',
  communications: 'bilanCategoryCommunications',
  schedule: 'bilanCategorySchedule',
  other: 'bilanCategoryOther'
};

/** The French label of a category. */
export const categoryLabel = (category: FeedbackCategory): string => fr[CATEGORY_LABEL_KEYS[category]] as string;

/** One item of a retour: a category's text, signed (private false) or private. */
export interface FeedbackItem {
  category: FeedbackCategory;
  private: boolean;
  text: string;
}

/**
 * What my_event_feedback() returns. `items`: the member's own items, private ones included, while
 * the window is open; after the close the signed ones only (a private item has no author any
 * more). Always [] in « Voir comme » (answer_hidden) and with the members' switch off.
 */
export interface MyEventFeedback {
  eligible: boolean;
  reason: 'not_registered' | 'cancelled' | 'waitlisted' | 'account_deleted' | null;
  window: 'not_yet' | 'open' | 'closed' | null;
  opens_on: string | null;
  closes_on: string | null;
  closes_at: string | null;
  closed_at: string | null;
  items: FeedbackItem[];
  answer_hidden: boolean;
}

/**
 * What the page shows:
 *   hidden       a « Voir comme » session: the same neutral state whatever the member wrote;
 *   closed_named after the close, the member's signed items, read-only;
 *   not_eligible not a registration that may answer (nothing to show);
 *   closed       after the close without a signed item: none, or private ones the levée
 *                unlinked, which nobody (the database included) can tell apart (ADR 0029);
 *   not_yet      the event hasn't started yet (or has no date);
 *   open         the form.
 */
export type FeedbackPageState = 'hidden' | 'closed_named' | 'not_eligible' | 'closed' | 'not_yet' | 'open';

export const feedbackPageState = (feedback: MyEventFeedback): FeedbackPageState => {
  if (feedback.answer_hidden) return 'hidden';
  if (feedback.window === 'closed' && (feedback.items ?? []).some(item => !item.private)) return 'closed_named';
  if (!feedback.eligible) return 'not_eligible';
  if (feedback.window === 'closed') return 'closed';
  if (feedback.window === 'open') return 'open';
  return 'not_yet';
};

/** Whether the pass links to the page: the window is open and the member may answer. */
export const canAnswerFeedback = (feedback: MyEventFeedback | null | undefined): boolean =>
  !!feedback && feedback.window === 'open' && feedback.eligible;

/** The member's item of a category and kind, if any. */
export const itemOf = (items: FeedbackItem[] | null | undefined, category: FeedbackCategory, isPrivate: boolean): FeedbackItem | null =>
  (items ?? []).find(item => item.category === category && item.private === isPrivate) ?? null;

// ---------------------------------------------------------------------------------------------
// The form (#355): each category card holds one or two comments, at most one of each kind. A new
// comment is signed; its « Privé » switch makes it private; once a card has one comment, the other
// kind can be added. Saving sends the non-blank comments as the member's whole set.

/** One comment being written on a card. `slot` is its stable key in the card ('a' or 'b'). */
export interface FeedbackDraft {
  slot: 'a' | 'b';
  private: boolean;
  text: string;
}
export type FeedbackDrafts = Record<FeedbackCategory, FeedbackDraft[]>;

const blankDraft = (): FeedbackDraft => ({ slot: 'a', private: false, text: '' });
const isBlank = (text: string | null | undefined): boolean => (text ?? '').trim() === '';

/** The form's state from the member's items: each card its items, signed first, or one blank signed comment. */
export const draftsFrom = (items: FeedbackItem[] | null | undefined): FeedbackDrafts =>
  Object.fromEntries(FEEDBACK_CATEGORIES.map(category => {
    const own = [false, true]
      .map(isPrivate => itemOf(items, category, isPrivate))
      .filter((item): item is FeedbackItem => !!item);
    const drafts: FeedbackDraft[] = own.length === 0
      ? [blankDraft()]
      : own.map((item, index) => ({ slot: index === 0 ? 'a' : 'b', private: item.private, text: item.text }));
    return [category, drafts];
  })) as FeedbackDrafts;

const updateCard = (drafts: FeedbackDrafts, category: FeedbackCategory, change: (card: FeedbackDraft[]) => FeedbackDraft[]): FeedbackDrafts =>
  ({ ...drafts, [category]: change(drafts[category] ?? [blankDraft()]) });

/** A comment's new text. */
export const setDraftText = (drafts: FeedbackDrafts, category: FeedbackCategory, slot: FeedbackDraft['slot'], text: string): FeedbackDrafts =>
  updateCard(drafts, category, card => card.map(draft => (draft.slot === slot ? { ...draft, text } : draft)));

/** Whether a comment's kind can be switched: only alone on its card (two would then be of one kind). */
export const canSwitchKind = (card: FeedbackDraft[]): boolean => card.length === 1;

/** Makes a card's only comment private or signed; unchanged when the card has two. */
export const setDraftPrivate = (drafts: FeedbackDrafts, category: FeedbackCategory, slot: FeedbackDraft['slot'], isPrivate: boolean): FeedbackDrafts =>
  updateCard(drafts, category, card => (canSwitchKind(card)
    ? card.map(draft => (draft.slot === slot ? { ...draft, private: isPrivate } : draft))
    : card));

/** The kind a card can still add (true = private), or null: it has two, or its one comment is blank. */
export const otherKindToAdd = (card: FeedbackDraft[]): boolean | null =>
  (card.length === 1 && !isBlank(card[0].text) ? !card[0].private : null);

/** Adds the other kind's comment to a card; unchanged when it can't (otherKindToAdd). */
export const addOtherKind = (drafts: FeedbackDrafts, category: FeedbackCategory): FeedbackDrafts =>
  updateCard(drafts, category, card => {
    const kind = otherKindToAdd(card);
    if (kind === null) return card;
    return [...card, { slot: card[0].slot === 'a' ? 'b' : 'a', private: kind, text: '' }];
  });

/** Whether a comment shows a remove action: one of two, or alone with text or private. */
export const canRemoveDraft = (card: FeedbackDraft[], draft: FeedbackDraft): boolean =>
  card.length > 1 || !isBlank(draft.text) || draft.private;

/** Removes a comment; a card's last one becomes a blank signed comment (a card always shows one). */
export const removeDraft = (drafts: FeedbackDrafts, category: FeedbackCategory, slot: FeedbackDraft['slot']): FeedbackDrafts =>
  updateCard(drafts, category, card => {
    const rest = card.filter(draft => draft.slot !== slot);
    return rest.length > 0 ? rest : [blankDraft()];
  });

/** The form's comments as items: the non-blank ones, in display order, signed first in a card. */
export const itemsFromDrafts = (drafts: FeedbackDrafts): FeedbackItem[] =>
  FEEDBACK_CATEGORIES.flatMap(category => [...(drafts[category] ?? [])]
    .filter(draft => !isBlank(draft.text))
    .sort((left, right) => Number(left.private) - Number(right.private))
    .map(draft => ({ category, private: draft.private, text: draft.text })));

const itemKey = (item: FeedbackItem): string => `${item.category}|${item.private}|${item.text}`;

/** Whether the form's comments differ from the saved items. */
export const draftsUnsaved = (drafts: FeedbackDrafts, saved: FeedbackItem[] | null | undefined): boolean => {
  const current = itemsFromDrafts(drafts).map(itemKey).sort();
  const stored = (saved ?? []).map(itemKey).sort();
  return current.length !== stored.length || current.some((key, index) => key !== stored[index]);
};

// ---------------------------------------------------------------------------------------------

// Logs the error's code and detail only: never the request, which holds the items.
const failure = (context: string, error: unknown, fallback: string): Error => {
  const { message, code, details, hint } = (error ?? {}) as ErrorLike & { code?: string; hint?: string };
  console.error(`${context}:`, message, code, details, hint);
  return appError(dbErrorMessage(error as ErrorLike, fallback));
};

type Client = SupabaseClient<Database>;

/** The caller's side of the event's post-mortem; throws an appError in French. */
export const fetchMyEventFeedback = async (client: Client, eventId: string): Promise<MyEventFeedback> => {
  const { data, error } = await client.rpc('my_event_feedback', { p_event_id: eventId });
  if (error) throw failure('Error loading the post-mortem', error, fr.bilanLoadError);
  const feedback = data as unknown as MyEventFeedback;
  return { ...feedback, items: feedback?.items ?? [] };
};

/**
 * Saves the caller's whole set of items (a pair left out is deleted, a kept one keeps its id; an
 * empty set deletes them all). Always send the full current set: a partial one deletes the rest.
 * Returns the items as saved (trimmed, blanks dropped). Throws an appError in French.
 */
export const submitEventFeedback = async (client: Client, eventId: string, items: FeedbackItem[]): Promise<FeedbackItem[]> => {
  const payload = items.map(({ category, private: isPrivate, text }) => ({ category, private: isPrivate, text }));
  const { data, error } = await client.rpc('submit_event_feedback', { p_event_id: eventId, p_items: payload });
  if (error) throw failure('Error saving the post-mortem', error, fr.bilanSaveError);
  return ((data as unknown as { items?: FeedbackItem[] })?.items) ?? [];
};

// ---------------------------------------------------------------------------------------------
// The admin event form's side (#329). The post-mortem (« bilan », #315, ADR 0029) closes at the end of the Toronto day
// "last day + feedback_days". The database computes it (private.event_feedback_dates()) but only
// for a saved row, and the event form needs it for the values being typed, so this mirrors it;
// eventFeedback.test.js pins the two together on dates taken from the database's function.

export const FEEDBACK_DAYS_DEFAULT = 14;
export const FEEDBACK_DAYS_MAX = 365;

export interface FeedbackEvent {
  status?: string | null;
  event_start_date?: InstantLike;
  duration_days?: number | string | null;
  feedback_days?: number | string | null;
  feedback_closed_at?: InstantLike;
}

export type FeedbackState = 'not_yet' | 'open' | 'closed';

export interface FeedbackWindow {
  state: FeedbackState;
  /** The last Toronto day one may answer, as a local-midnight Date; null without a start date or a valid offset. */
  closesOn: Date | null;
  /** The instant the feedback closes by date: the start of the next Toronto day. */
  closesAt: Date | null;
  /** The Toronto day the close really happened (the marker's), when it already did. */
  closedOn: Date | null;
}

const pad = (n: number): string => String(n).padStart(2, '0');
const localDay = (c: { year: number; month: number; day: number }): Date => new Date(c.year, c.month - 1, c.day);

// Calendar days on UTC arithmetic: no daylight-saving drift.
const plusDays = (c: { year: number; month: number; day: number }, days: number) => {
  const d = new Date(Date.UTC(c.year, c.month - 1, c.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};
const midnight = (c: { year: number; month: number; day: number }): Date =>
  fromEventLocal(`${c.year}-${pad(c.month)}-${pad(c.day)}T00:00`)!;

// The event form's draft holds the start as the datetime-local input's text, in the event zone.
const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const startInstant = (value: InstantLike): InstantLike =>
  (typeof value === 'string' && LOCAL_DATETIME.test(value) ? fromEventLocal(value) : value);

const wholeNumber = (value: number | string | null | undefined): number | null => {
  const text = String(value ?? '').trim();
  return /^\d+$/.test(text) ? Number(text) : null;
};

/**
 * The state and dates of an event's post-mortem window. Mirrors private.event_feedback_window():
 * closed once the marker is set or the event is archived; not yet for a non-ACTIVE event or one
 * without a start date; otherwise closed from the close instant, open from the event's first day,
 * not yet before.
 */
export const getFeedbackWindow = (event: FeedbackEvent | null | undefined, now: Date = new Date()): FeedbackWindow => {
  const start = eventClock(startInstant(event?.event_start_date));
  const days = wholeNumber(event?.feedback_days ?? FEEDBACK_DAYS_DEFAULT);
  const duration = wholeNumber(event?.duration_days ?? 1) ?? 1;
  // The marker is the scheduled close (a Toronto midnight, which belongs to the day before) or the
  // moment of an earlier close (archival, a save): one millisecond back gives the day it closed on.
  const marker = toInstant(event?.feedback_closed_at);
  const closedOn = marker ? eventClock(new Date(marker.getTime() - 1)) : null;
  const done = !!closedOn || event?.status === 'ARCHIVED';

  let closesOn = null;
  let closesAt = null;
  let opensAt = null;
  if (start && days != null && days >= 1) {
    // Opens on the first day; closes at the end of "last day + feedback_days" (the day after the last day is day 0).
    opensAt = midnight(start);
    const afterLast = plusDays(start, duration);
    closesOn = localDay(plusDays(afterLast, days - 1));
    closesAt = midnight(plusDays(afterLast, days));
  }
  let state: FeedbackState = 'not_yet';
  if (done) state = 'closed';
  else if (event?.status === 'ACTIVE' && closesAt && opensAt) {
    if (closesAt.getTime() <= now.getTime()) state = 'closed';
    else if (opensAt.getTime() <= now.getTime()) state = 'open';
  }
  return { state, closesOn, closesAt, closedOn: closedOn ? localDay(closedOn) : null };
};

/** True when saving `after` closes the feedback for good while `before` still has it not closed. */
export const closesOnSave = (before: FeedbackEvent, after: FeedbackEvent, now: Date = new Date()): boolean =>
  getFeedbackWindow(before, now).state !== 'closed' && getFeedbackWindow(after, now).state === 'closed';
