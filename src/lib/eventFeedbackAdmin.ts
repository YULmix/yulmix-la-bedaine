import type { SupabaseClient } from '@supabase/supabase-js';
import fr from '../locales/fr.json';
import { appError, dbErrorMessage } from './dbErrors';
import type { ErrorLike } from './dbErrors';
import type { Database } from './database.types';
import { FEEDBACK_CATEGORIES, getFeedbackWindow } from './eventFeedback';
import type { FeedbackEvent } from './eventFeedback';
import { eventDay } from './eventTime';
import { formatDate } from './format';
import type { FeedbackCategory } from './eventFeedback';

// The admin « Bilan » section (#317): an event's post-mortem items, over the database's
// event_feedback_answers() and event_feedback_counts() (#315, #345, #354, ADR 0029). The database
// decides everything: admins only; signed items live, with their author and no time; private
// items only once released (3 different private authors), texts only, in random order. This
// module only groups what it returns by category and shapes the counts.
//
// Privacy (ADR 0029, zero ways to link a private item to its author): a private item is kept as
// its text only, in the order the database returned it (never re-sorted), with no id, date or
// position of its own; the grouping drops everything else the payload might carry.

/** A signed item's author as stored (null: a hard-deleted account). */
export interface FeedbackAuthor {
  id: string | null;
  party: string | null;
  name: string | null;
  email: string | null;
}

export interface SignedFeedbackItem {
  category: FeedbackCategory;
  text: string;
  author: FeedbackAuthor | null;
}

export interface PrivateFeedbackItem {
  category: FeedbackCategory;
  text: string;
}

/**
 * What event_feedback_answers() returns, before and after the close. `signed`: every signed
 * item, in category order then by author name (no time, no order that follows one). `private`:
 * [] until `released`, then every private item in random (id) order.
 */
export interface EventFeedbackAnswers {
  closed: boolean;
  closes_on: string | null;
  closes_at: string | null;
  closed_at: string | null;
  released: boolean;
  signed: SignedFeedbackItem[];
  private: PrivateFeedbackItem[];
}

/** One category's items: the signed ones with their author's label, then the private texts. */
export interface CategoryAnswers {
  category: FeedbackCategory;
  signed: Array<{ author: string; text: string }>;
  private: string[];
}

const textOf = (item: { text?: unknown } | null | undefined): string | null =>
  (typeof item?.text === 'string' && item.text.trim() !== '' ? item.text : null);

/** How a signed item's author is shown: the name, else the email, else « Compte supprimé ». */
export const authorLabel = (author: FeedbackAuthor | null | undefined): string =>
  author?.name?.trim() || author?.email || fr.adminBilanDeletedAuthor;

/**
 * The items by category, every category in display order (an empty one included). Within a
 * category: the signed items in the database's order, then the private texts in the database's
 * order. Nothing without a result.
 */
export const groupByCategory = (result: EventFeedbackAnswers | null | undefined): CategoryAnswers[] => {
  if (!result) return [];
  const signed = result.signed ?? [];
  const privateItems = result.private ?? [];
  return FEEDBACK_CATEGORIES.map(category => ({
    category,
    signed: signed.flatMap(item => {
      const text = item.category === category ? textOf(item) : null;
      return text === null ? [] : [{ author: authorLabel(item.author), text }];
    }),
    private: privateItems.flatMap(item => {
      const text = item.category === category ? textOf(item) : null;
      return text === null ? [] : [text];
    })
  }));
};

// Logs the error's code and detail only.
const failure = (context: string, error: unknown, fallback: string): Error => {
  const { message, code, details, hint } = (error ?? {}) as ErrorLike & { code?: string; hint?: string };
  console.error(`${context}:`, message, code, details, hint);
  return appError(dbErrorMessage(error as ErrorLike, fallback));
};

type Client = SupabaseClient<Database>;

/** The event's post-mortem items (admins only), before or after the close; throws an appError in French. */
export const fetchEventFeedbackAnswers = async (client: Client, eventId: string): Promise<EventFeedbackAnswers> => {
  const { data, error } = await client.rpc('event_feedback_answers', { p_event_id: eventId });
  if (error) throw failure('Error loading the post-mortem answers', error, fr.adminBilanLoadError);
  return data as unknown as EventFeedbackAnswers;
};

/** One category's counts: its signed items, and its private ones (null until released). */
export interface CategoryCounts {
  category: FeedbackCategory;
  signed: number;
  private: number | null;
}

/**
 * What event_feedback_counts() returns (#345, #354, ADR 0029), before and after the close.
 * `signed_members`: the members with at least one signed item, over `eligible`. Every private
 * number is null until `released`. No text, author, id or time.
 */
export interface EventFeedbackCounts {
  closed: boolean;
  closes_on: string | null;
  eligible: number;
  signed_members: number;
  released: boolean;
  categories: CategoryCounts[];
  signed_total: number;
  private_total: number | null;
}

const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * The counts as the database returned them, keeping only the known fields, every category in
 * display order. The database applies the release; this keeps every private number null while
 * `released` isn't true, whatever the payload says.
 */
export const toFeedbackCounts = (data: unknown): EventFeedbackCounts => {
  const raw = (data ?? {}) as Record<string, unknown>;
  const released = raw.released === true;
  const rows = Array.isArray(raw.categories) ? raw.categories as Array<Record<string, unknown>> : [];
  return {
    closed: raw.closed === true,
    closes_on: typeof raw.closes_on === 'string' ? raw.closes_on : null,
    eligible: count(raw.eligible) ?? 0,
    signed_members: count(raw.signed_members) ?? 0,
    released,
    categories: FEEDBACK_CATEGORIES.map(category => {
      const row = rows.find(entry => entry?.category === category);
      return { category, signed: count(row?.signed) ?? 0, private: released ? count(row?.private) ?? 0 : null };
    }),
    signed_total: count(raw.signed_total) ?? 0,
    private_total: released ? count(raw.private_total) ?? 0 : null
  };
};

/** How many items the event's post-mortem has (admins only), before or after the close; throws an appError in French. */
export const fetchEventFeedbackCounts = async (client: Client, eventId: string): Promise<EventFeedbackCounts> => {
  const { data, error } = await client.rpc('event_feedback_counts', { p_event_id: eventId });
  if (error) throw failure('Error loading the post-mortem counts', error, fr.adminBilanLoadError);
  return toFeedbackCounts(data);
};

/** The members who signed at least one item, in whole percent of the eligible registrations (0 to 100). */
export const signedRate = ({ eligible, signed_members: signed }: Pick<EventFeedbackCounts, 'eligible' | 'signed_members'>): number =>
  eligible > 0 ? Math.min(100, Math.max(0, Math.round((signed / eligible) * 100))) : 0;

/**
 * The dashboard tag's text (#364): « Clos le » once the database says closed; « S'ouvre le » before the
 * event's first day (the member side's getFeedbackWindow, so one rule for both, ADR 0029); otherwise
 * « Ouvert jusqu'au » the last day, or just « Ouvert » without a date.
 */
export const bilanStatus = (
  { closed, closedAt, closesOn, event, now }: { closed: boolean; closedAt?: string | null; closesOn?: string | null; event?: FeedbackEvent | null; now?: Date }
): string => {
  if (closed) return fr.adminBilanCountsClosedOn.replace('{date}', formatDate(eventDay(closedAt ?? null) as unknown as string));
  const win = getFeedbackWindow(event, now);
  if (win.state === 'not_yet' && win.opensOn) return fr.adminBilanCountsOpensOn.replace('{date}', formatDate(win.opensOn as unknown as string));
  return closesOn ? fr.adminBilanCountsOpenUntil.replace('{date}', formatDate(closesOn)) : fr.adminBilanCountsOpen;
};
