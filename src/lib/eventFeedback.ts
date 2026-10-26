import type { SupabaseClient } from '@supabase/supabase-js';
import fr from '../locales/fr.json';
import { appError, dbErrorMessage } from './dbErrors';
import type { ErrorLike } from './dbErrors';
import type { Database } from './database.types';
import { eventClock, fromEventLocal, toInstant } from './eventTime';
import type { InstantLike } from './eventTime';

// The member's post-mortem, « bilan » (#316), over the database's my_event_feedback() and
// submit_event_feedback() (#315, ADR 0029). The database decides everything: the window (its
// state and dates come from my_event_feedback(), never computed here), eligibility, « Voir comme »
// hiding the answer. This module only reads its answer into a page state.
//
// Privacy (ADR 0029): an anonymous answer must not be linkable to its author, on the device
// either. Nothing here stores, logs or sends an answer anywhere but to submit_event_feedback():
// the page keeps its unsaved text in React state only, and an error is logged without it.

/** The categories, in display order: the keys of the answers object (the database's). */
export const FEEDBACK_CATEGORIES = ['welcome', 'party_music', 'safety', 'lodging', 'food', 'communications', 'schedule', 'other'] as const;
export type FeedbackCategory = typeof FEEDBACK_CATEGORIES[number];
export type FeedbackAnswers = Record<FeedbackCategory, string>;

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

/** What my_event_feedback() returns (its answer is null after the close unless named). */
export interface MyEventFeedback {
  eligible: boolean;
  reason: 'not_registered' | 'cancelled' | 'waitlisted' | 'account_deleted' | null;
  window: 'not_yet' | 'open' | 'closed' | null;
  opens_on: string | null;
  closes_on: string | null;
  closes_at: string | null;
  closed_at: string | null;
  answer: { answers: Partial<Record<FeedbackCategory, string | null>>; is_anonymous: boolean; created_at: string; updated_at: string } | null;
  answer_hidden: boolean;
}

/**
 * What the page shows:
 *   hidden       a « Voir comme » session: the same neutral state whatever the member answered;
 *   closed_named after the close, the member's named answer, read-only;
 *   not_eligible not a registration that may answer (no answer to show);
 *   closed       after the close without a named answer: no answer, or an anonymous one the levée
 *                unlinked, which nobody (the database included) can tell apart (ADR 0029);
 *   not_yet      the event hasn't started yet (or has no date);
 *   open         the form.
 */
export type FeedbackPageState = 'hidden' | 'closed_named' | 'not_eligible' | 'closed' | 'not_yet' | 'open';

export const feedbackPageState = (feedback: MyEventFeedback): FeedbackPageState => {
  if (feedback.answer_hidden) return 'hidden';
  if (feedback.window === 'closed' && feedback.answer) return 'closed_named';
  if (!feedback.eligible) return 'not_eligible';
  if (feedback.window === 'closed') return 'closed';
  if (feedback.window === 'open') return 'open';
  return 'not_yet';
};

/** Whether the pass links to the page: the window is open and the member may answer. */
export const canAnswerFeedback = (feedback: MyEventFeedback | null | undefined): boolean =>
  !!feedback && feedback.window === 'open' && feedback.eligible;

/** Every category, blank. */
export const emptyAnswers = (): FeedbackAnswers =>
  Object.fromEntries(FEEDBACK_CATEGORIES.map(category => [category, ''])) as FeedbackAnswers;

/** A saved answer's texts as the form's state (every category, '' when not answered). */
export const answersFrom = (answer: MyEventFeedback['answer']): FeedbackAnswers =>
  Object.fromEntries(FEEDBACK_CATEGORIES.map(category => [category, answer?.answers?.[category] ?? ''])) as FeedbackAnswers;

/** Whether at least one category has a non-blank text (the database's own rule). */
export const hasAnyAnswer = (answers: FeedbackAnswers): boolean =>
  FEEDBACK_CATEGORIES.some(category => (answers[category] ?? '').trim() !== '');

/** Whether the form differs from what's saved (the texts and the choice). */
export const isUnsaved = (answers: FeedbackAnswers, isAnonymous: boolean, saved: MyEventFeedback['answer']): boolean =>
  FEEDBACK_CATEGORIES.some(category => (answers[category] ?? '') !== (saved?.answers?.[category] ?? ''))
  || (!!saved && isAnonymous !== saved.is_anonymous);

// Logs the error's code and detail only: never the request, which holds the answer.
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
  return data as unknown as MyEventFeedback;
};

/** Saves the caller's answer (create or replace); returns it as saved. Throws an appError in French. */
export const submitEventFeedback = async (
  client: Client, eventId: string, answers: FeedbackAnswers, isAnonymous: boolean
): Promise<NonNullable<MyEventFeedback['answer']>> => {
  const { data, error } = await client.rpc('submit_event_feedback', { p_event_id: eventId, p_answers: answers, p_is_anonymous: isAnonymous });
  if (error) throw failure('Error saving the post-mortem', error, fr.bilanSaveError);
  return data as unknown as NonNullable<MyEventFeedback['answer']>;
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
