import type { SupabaseClient } from '@supabase/supabase-js';
import fr from '../locales/fr.json';
import { appError, dbErrorMessage } from './dbErrors';
import type { ErrorLike } from './dbErrors';
import type { Database } from './database.types';
import { FEEDBACK_CATEGORIES } from './eventFeedback';
import type { FeedbackCategory } from './eventFeedback';
import { REGISTRATION_STATUS } from './registrationOptions';

// The admin « Bilan » section (#317): an event's post-mortem answers, over the database's
// event_feedback_answers() (#315, ADR 0029). The database decides everything: admins only, nothing
// before the close (no answer, no count), the anonymous answers only when there are 3 or more,
// texts only, in random order. This module only groups what it returns by category.
//
// Privacy (ADR 0029, zero ways to link an anonymous answer to its author): an anonymous answer
// is kept as its texts only, in the order the database returned them (never re-sorted), with no
// id, date or position of its own; the grouping drops everything else the payload might carry.

type Texts = Partial<Record<FeedbackCategory, string | null>>;

/** A named answer's author as stored (null: a hard-deleted account). */
export interface FeedbackAuthor {
  user_id: string | null;
  party_id: string | null;
  full_name: string | null;
  email: string | null;
}

/** What event_feedback_answers() returns. Before the close, named and anonymous are null. */
export interface EventFeedbackAnswers {
  closed: boolean;
  closes_on: string | null;
  closes_at: string | null;
  closed_at: string | null;
  named: Array<{ answers: Texts; author: FeedbackAuthor | null; created_at: string; updated_at: string }> | null;
  anonymous: Array<{ answers: Texts }> | null;
}

/** One category's answers: the named ones with their author's label, then the anonymous texts. */
export interface CategoryAnswers {
  category: FeedbackCategory;
  named: Array<{ author: string; text: string }>;
  anonymous: string[];
}

const textOf = (answers: Texts | null | undefined, category: FeedbackCategory): string | null => {
  const text = answers?.[category];
  return typeof text === 'string' && text.trim() !== '' ? text : null;
};

/** How a named answer's author is shown: the name, else the email, else « Compte supprimé ». */
export const authorLabel = (author: FeedbackAuthor | null | undefined): string =>
  author?.full_name?.trim() || author?.email || fr.adminBilanDeletedAuthor;

/**
 * The answers by category, every category in display order (an empty one included). Within a
 * category: the named answers in the database's order, then the anonymous texts in the database's
 * order. Nothing for a result that isn't closed.
 */
export const groupByCategory = (result: EventFeedbackAnswers | null | undefined): CategoryAnswers[] => {
  if (!result?.closed) return [];
  const named = result.named ?? [];
  const anonymous = result.anonymous ?? [];
  return FEEDBACK_CATEGORIES.map(category => ({
    category,
    named: named.flatMap(answer => {
      const text = textOf(answer.answers, category);
      return text === null ? [] : [{ author: authorLabel(answer.author), text }];
    }),
    anonymous: anonymous.flatMap(answer => {
      const text = textOf(answer.answers, category);
      return text === null ? [] : [text];
    })
  }));
};

/** The counts the section shows after the close: named answers, and the anonymous ones (0 when not shown). */
export const answerCounts = (result: EventFeedbackAnswers | null | undefined): { named: number; anonymous: number } => ({
  named: result?.closed ? (result.named ?? []).length : 0,
  anonymous: result?.closed ? (result.anonymous ?? []).length : 0
});

// Logs the error's code and detail only.
const failure = (context: string, error: unknown, fallback: string): Error => {
  const { message, code, details, hint } = (error ?? {}) as ErrorLike & { code?: string; hint?: string };
  console.error(`${context}:`, message, code, details, hint);
  return appError(dbErrorMessage(error as ErrorLike, fallback));
};

type Client = SupabaseClient<Database>;

/** The event's post-mortem answers (admins only); throws an appError in French. */
export const fetchEventFeedbackAnswers = async (client: Client, eventId: string): Promise<EventFeedbackAnswers> => {
  const { data, error } = await client.rpc('event_feedback_answers', { p_event_id: eventId });
  if (error) throw failure('Error loading the post-mortem answers', error, fr.adminBilanLoadError);
  return data as unknown as EventFeedbackAnswers;
};

/**
 * What event_feedback_counts() returns (#345, ADR 0029), before and after the close. `anonymous`
 * is null while there are fewer than 3 anonymous answers (the UI says « moins de 3 »), and `total`
 * is null with it (total − signed would give it away). No text, author, id or time.
 */
export interface EventFeedbackCounts {
  closed: boolean;
  closes_on: string | null;
  eligible: number;
  signed: number;
  anonymous: number | null;
  total: number | null;
}

const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * The counts as the database returned them, keeping only the known fields. The database applies
 * the threshold; this keeps `total` null whenever `anonymous` is, whatever the payload says.
 */
export const toFeedbackCounts = (data: unknown): EventFeedbackCounts => {
  const raw = (data ?? {}) as Record<string, unknown>;
  const anonymous = count(raw.anonymous);
  return {
    closed: raw.closed === true,
    closes_on: typeof raw.closes_on === 'string' ? raw.closes_on : null,
    eligible: count(raw.eligible) ?? 0,
    signed: count(raw.signed) ?? 0,
    anonymous,
    total: anonymous === null ? null : count(raw.total)
  };
};

/** How many answers the event's post-mortem has (admins only), before or after the close; throws an appError in French. */
export const fetchEventFeedbackCounts = async (client: Client, eventId: string): Promise<EventFeedbackCounts> => {
  const { data, error } = await client.rpc('event_feedback_counts', { p_event_id: eventId });
  if (error) throw failure('Error loading the post-mortem counts', error, fr.adminBilanLoadError);
  return toFeedbackCounts(data);
};

/**
 * The event's registrations that may answer: neither cancelled nor waitlisted (#315's eligibility).
 * A count only, read after the close.
 */
export const fetchEligibleRegistrationCount = async (client: Client, eventId: string): Promise<number> => {
  const { count, error } = await client.from('user_parties')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .neq('status', REGISTRATION_STATUS.CANCELLED)
    .not('is_waitlisted', 'is', true);
  if (error) throw failure('Error counting the registrations', error, fr.adminBilanLoadError);
  return count ?? 0;
};
