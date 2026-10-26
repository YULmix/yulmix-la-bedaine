import type { SupabaseClient } from '@supabase/supabase-js';
import fr from '../locales/fr.json';
import { appError, dbErrorMessage } from './dbErrors';
import type { ErrorLike } from './dbErrors';
import type { Database } from './database.types';

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
 *   not_yet      the event isn't over yet (or has no date);
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
