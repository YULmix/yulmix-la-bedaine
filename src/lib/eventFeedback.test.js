import {
  FEEDBACK_CATEGORIES,
  answersFrom,
  canAnswerFeedback,
  categoryLabel,
  emptyAnswers,
  feedbackPageState,
  hasAnyAnswer,
  isUnsaved
} from './eventFeedback';

// my_event_feedback()'s shape, an open window and an eligible member without an answer.
const base = {
  eligible: true,
  reason: null,
  window: 'open',
  opens_on: '2026-10-20',
  closes_on: '2026-11-02',
  closes_at: '2026-11-03T04:00:00+00:00',
  closed_at: null,
  answer: null,
  answer_hidden: false
};
const named = { answers: { welcome: 'Super accueil', food: null }, is_anonymous: false, created_at: 'x', updated_at: 'x' };
const anonymous = { ...named, is_anonymous: true };

describe('feedbackPageState', () => {
  test('open and eligible: the form, with or without an answer', () => {
    expect(feedbackPageState(base)).toBe('open');
    expect(feedbackPageState({ ...base, answer: anonymous })).toBe('open');
  });

  test('« Voir comme »: hidden, whatever the window or eligibility', () => {
    for (const window of ['not_yet', 'open', 'closed']) {
      expect(feedbackPageState({ ...base, window, answer_hidden: true })).toBe('hidden');
      expect(feedbackPageState({ ...base, window, answer_hidden: true, eligible: false, reason: 'cancelled' })).toBe('hidden');
    }
  });

  test('closed with a named answer: read-only, even if no longer eligible', () => {
    expect(feedbackPageState({ ...base, window: 'closed', answer: named })).toBe('closed_named');
    expect(feedbackPageState({ ...base, window: 'closed', answer: named, eligible: false, reason: 'cancelled' })).toBe('closed_named');
  });

  test('closed without an answer: one neutral state (no answer and an unlinked anonymous one look the same)', () => {
    expect(feedbackPageState({ ...base, window: 'closed' })).toBe('closed');
  });

  test('not eligible: the message, before any window state', () => {
    for (const reason of ['not_registered', 'cancelled', 'waitlisted', 'account_deleted']) {
      expect(feedbackPageState({ ...base, eligible: false, reason })).toBe('not_eligible');
      expect(feedbackPageState({ ...base, eligible: false, reason, window: 'closed' })).toBe('not_eligible');
    }
  });

  test('not yet open, or no window at all', () => {
    expect(feedbackPageState({ ...base, window: 'not_yet' })).toBe('not_yet');
    expect(feedbackPageState({ ...base, window: null, opens_on: null, closes_on: null })).toBe('not_yet');
  });
});

describe('canAnswerFeedback (the pass card)', () => {
  test('only an open window and an eligible member', () => {
    expect(canAnswerFeedback(base)).toBe(true);
    expect(canAnswerFeedback({ ...base, window: 'not_yet' })).toBe(false);
    expect(canAnswerFeedback({ ...base, window: 'closed' })).toBe(false);
    expect(canAnswerFeedback({ ...base, eligible: false, reason: 'waitlisted' })).toBe(false);
    expect(canAnswerFeedback(null)).toBe(false);
  });

  test('the same in « Voir comme »: it never depends on the answer', () => {
    expect(canAnswerFeedback({ ...base, answer_hidden: true })).toBe(true);
  });
});

describe('the form state', () => {
  test('every category, in the database\'s order, with a French label', () => {
    expect(FEEDBACK_CATEGORIES).toEqual(['welcome', 'party_music', 'safety', 'lodging', 'food', 'communications', 'schedule', 'other']);
    expect(FEEDBACK_CATEGORIES.map(categoryLabel)).toEqual(['Accueil', 'Party + musique', 'Sécurité', 'Hébergement', 'Nourriture', 'Communications', 'Horaire', 'Autres']);
  });

  test('answersFrom fills every category, null and missing as blank', () => {
    expect(answersFrom(named)).toEqual({ ...emptyAnswers(), welcome: 'Super accueil' });
    expect(answersFrom(null)).toEqual(emptyAnswers());
  });

  test('hasAnyAnswer ignores blank texts', () => {
    expect(hasAnyAnswer(emptyAnswers())).toBe(false);
    expect(hasAnyAnswer({ ...emptyAnswers(), food: '  \n ' })).toBe(false);
    expect(hasAnyAnswer({ ...emptyAnswers(), food: 'Bon' })).toBe(true);
  });

  test('isUnsaved: the texts, and the named ↔ anonymous switch', () => {
    expect(isUnsaved(emptyAnswers(), false, null)).toBe(false);
    expect(isUnsaved({ ...emptyAnswers(), food: 'x' }, false, null)).toBe(true);
    expect(isUnsaved(answersFrom(named), false, named)).toBe(false);
    expect(isUnsaved(answersFrom(named), true, named)).toBe(true);
    expect(isUnsaved({ ...answersFrom(named), welcome: 'Autre' }, false, named)).toBe(true);
  });
});
