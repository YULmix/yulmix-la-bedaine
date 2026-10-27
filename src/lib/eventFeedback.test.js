import fr from '../locales/fr.json';
import {
  FEEDBACK_CATEGORIES,
  addOtherKind,
  canAnswerFeedback,
  canRemoveDraft,
  canSwitchKind,
  categoryLabel,
  closesOnSave,
  draftsFrom,
  draftsUnsaved,
  feedbackPageState,
  getFeedbackWindow,
  fetchMyEventFeedback,
  itemOf,
  itemsFromDrafts,
  otherKindToAdd,
  removeDraft,
  setDraftPrivate,
  setDraftText,
  submitEventFeedback
} from './eventFeedback';

// my_event_feedback()'s shape (#354), an open window and an eligible member without an item.
const base = {
  eligible: true,
  reason: null,
  window: 'open',
  opens_on: '2026-10-20',
  closes_on: '2026-11-02',
  closes_at: '2026-11-03T04:00:00+00:00',
  closed_at: null,
  items: [],
  answer_hidden: false
};
const signedItems = [{ category: 'welcome', private: false, text: 'Super accueil' }];
const privateItems = [{ category: 'food', private: true, text: 'Trop salé' }];

describe('feedbackPageState', () => {
  test('open and eligible: the form, with or without an answer', () => {
    expect(feedbackPageState(base)).toBe('open');
    expect(feedbackPageState({ ...base, items: privateItems })).toBe('open');
    expect(feedbackPageState({ ...base, items: [...signedItems, ...privateItems] })).toBe('open');
  });

  test('« Voir comme »: hidden, whatever the window or eligibility', () => {
    for (const window of ['not_yet', 'open', 'closed']) {
      expect(feedbackPageState({ ...base, window, answer_hidden: true })).toBe('hidden');
      expect(feedbackPageState({ ...base, window, answer_hidden: true, eligible: false, reason: 'cancelled' })).toBe('hidden');
    }
  });

  test('closed with a signed item: read-only, even if no longer eligible', () => {
    expect(feedbackPageState({ ...base, window: 'closed', items: signedItems })).toBe('closed_named');
    expect(feedbackPageState({ ...base, window: 'closed', items: signedItems, eligible: false, reason: 'cancelled' })).toBe('closed_named');
  });

  test('closed without an answer: one neutral state (no answer and an unlinked anonymous one look the same)', () => {
    expect(feedbackPageState({ ...base, window: 'closed' })).toBe('closed');
    // The database returns no private item after the close; one in a payload changes nothing.
    expect(feedbackPageState({ ...base, window: 'closed', items: privateItems })).toBe('closed');
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

  test('itemOf finds a category\'s item of one kind', () => {
    const items = [...signedItems, { category: 'welcome', private: true, text: 'En privé' }];
    expect(itemOf(items, 'welcome', false)).toEqual(signedItems[0]);
    expect(itemOf(items, 'welcome', true).text).toBe('En privé');
    expect(itemOf(items, 'food', false)).toBeNull();
    expect(itemOf(null, 'food', false)).toBeNull();
  });

});

// The form's comments (#355): one or two per card, at most one of each kind, signed by default.
describe('the form drafts', () => {
  const blank = { slot: 'a', private: false, text: '' };

  test('draftsFrom: every card its items, signed first, or one blank signed comment', () => {
    const drafts = draftsFrom([
      { category: 'party_music', private: true, text: 'En privé' },
      { category: 'party_music', private: false, text: 'Signé' },
      ...privateItems
    ]);
    expect(Object.keys(drafts)).toEqual([...FEEDBACK_CATEGORIES]);
    expect(drafts.party_music).toEqual([
      { slot: 'a', private: false, text: 'Signé' }, { slot: 'b', private: true, text: 'En privé' }
    ]);
    expect(drafts.food).toEqual([{ slot: 'a', private: true, text: 'Trop salé' }]);
    expect(drafts.welcome).toEqual([blank]);
    expect(draftsFrom(null).other).toEqual([blank]);
  });

  test('a new comment is signed; the switch makes it private only while it is alone on its card', () => {
    let drafts = draftsFrom([]);
    drafts = setDraftText(drafts, 'party_music', 'a', 'Super DJ');
    drafts = setDraftPrivate(drafts, 'party_music', 'a', true);
    expect(drafts.party_music).toEqual([{ slot: 'a', private: true, text: 'Super DJ' }]);
    expect(canSwitchKind(drafts.party_music)).toBe(true);
    drafts = addOtherKind(drafts, 'party_music');
    expect(drafts.party_music).toEqual([{ slot: 'a', private: true, text: 'Super DJ' }, { slot: 'b', private: false, text: '' }]);
    // Two of one kind can't happen: with two comments the switch does nothing.
    expect(canSwitchKind(drafts.party_music)).toBe(false);
    expect(setDraftPrivate(drafts, 'party_music', 'b', true).party_music).toEqual(drafts.party_music);
  });

  test('otherKindToAdd / addOtherKind: the other kind once the one comment has text, never a third', () => {
    const drafts = draftsFrom([]);
    expect(otherKindToAdd(drafts.food)).toBeNull();
    expect(addOtherKind(drafts, 'food').food).toEqual([blank]);
    const signed = setDraftText(drafts, 'food', 'a', 'Bon');
    expect(otherKindToAdd(signed.food)).toBe(true);
    const both = addOtherKind(signed, 'food');
    expect(both.food.map(draft => draft.private)).toEqual([false, true]);
    expect(otherKindToAdd(both.food)).toBeNull();
    expect(addOtherKind(both, 'food').food).toHaveLength(2);
    const privateOnly = setDraftPrivate(signed, 'food', 'a', true);
    expect(otherKindToAdd(privateOnly.food)).toBe(false);
  });

  test('removeDraft: one of two goes; the last one becomes a blank signed comment', () => {
    const both = draftsFrom([{ category: 'food', private: false, text: 'Bon' }, { category: 'food', private: true, text: 'Salé' }]);
    const onlyPrivate = removeDraft(both, 'food', 'a');
    expect(onlyPrivate.food).toEqual([{ slot: 'b', private: true, text: 'Salé' }]);
    // Adding back takes the free slot, so keys stay unique.
    expect(addOtherKind(onlyPrivate, 'food').food.map(draft => draft.slot)).toEqual(['b', 'a']);
    expect(removeDraft(onlyPrivate, 'food', 'b').food).toEqual([blank]);
  });

  test('canRemoveDraft: one of two, or alone with text or private', () => {
    expect(canRemoveDraft([blank], blank)).toBe(false);
    expect(canRemoveDraft([{ ...blank, text: 'x' }], { ...blank, text: 'x' })).toBe(true);
    expect(canRemoveDraft([{ ...blank, private: true }], { ...blank, private: true })).toBe(true);
    const two = [blank, { slot: 'b', private: true, text: '' }];
    expect(canRemoveDraft(two, two[1])).toBe(true);
  });

  test('itemsFromDrafts: the non-blank comments, in display order, signed first in a card', () => {
    let drafts = draftsFrom([]);
    drafts = setDraftText(drafts, 'other', 'a', 'Merci');
    drafts = setDraftText(drafts, 'welcome', 'a', 'Privé ici');
    drafts = setDraftPrivate(drafts, 'welcome', 'a', true);
    drafts = addOtherKind(drafts, 'welcome');
    drafts = setDraftText(drafts, 'welcome', 'b', 'Signé ici');
    drafts = setDraftText(drafts, 'food', 'a', '  \n ');
    expect(itemsFromDrafts(drafts)).toEqual([
      { category: 'welcome', private: false, text: 'Signé ici' },
      { category: 'welcome', private: true, text: 'Privé ici' },
      { category: 'other', private: false, text: 'Merci' }
    ]);
    expect(itemsFromDrafts(draftsFrom([]))).toEqual([]);
  });

  test('draftsUnsaved: texts, kinds and removals, whatever the order', () => {
    const saved = [...signedItems, ...privateItems];
    const drafts = draftsFrom(saved);
    expect(draftsUnsaved(drafts, saved)).toBe(false);
    expect(draftsUnsaved(drafts, [...privateItems, ...signedItems])).toBe(false);
    expect(draftsUnsaved(draftsFrom([]), [])).toBe(false);
    expect(draftsUnsaved(setDraftText(drafts, 'welcome', 'a', 'Autre'), saved)).toBe(true);
    expect(draftsUnsaved(setDraftPrivate(drafts, 'food', 'a', false), saved)).toBe(true);
    expect(draftsUnsaved(removeDraft(drafts, 'food', 'a'), saved)).toBe(true);
    // A blank comment added and left empty is not a change.
    expect(draftsUnsaved(addOtherKind(drafts, 'food'), saved)).toBe(false);
  });
});

describe('the database calls', () => {
  const clientReturning = (result) => ({ rpc: jest.fn().mockResolvedValue(result) });

  test('submitEventFeedback sends the items as { category, private, text } and returns the saved ones', async () => {
    const saved = [{ category: 'food', private: true, text: 'Bon' }];
    const client = clientReturning({ data: { items: saved }, error: null });
    await expect(submitEventFeedback(client, 'event-1', [{ category: 'food', private: true, text: ' Bon ', extra: 'x' }])).resolves.toEqual(saved);
    expect(client.rpc).toHaveBeenCalledWith('submit_event_feedback', {
      p_event_id: 'event-1', p_items: [{ category: 'food', private: true, text: ' Bon ' }]
    });
  });

  test('a refused save throws in French, without logging the items', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const client = clientReturning({ data: null, error: { message: 'event_feedback_duplicate', code: '23514', details: '{"category":"food","private":true}' } });
    await expect(submitEventFeedback(client, 'event-1', [{ category: 'food', private: true, text: 'Secret' }]))
      .rejects.toThrow(fr.dbErrorEventFeedbackDuplicate);
    expect(JSON.stringify(log.mock.calls)).not.toContain('Secret');
    log.mockRestore();
  });

  test('fetchMyEventFeedback: items default to []', async () => {
    const client = clientReturning({ data: { ...base, items: undefined }, error: null });
    await expect(fetchMyEventFeedback(client, 'event-1')).resolves.toEqual(base);
  });
});


// Each row is private.event_feedback_dates() of the same inputs, read from the database
// (start instant, duration_days, feedback_days -> opens_on, closes_on, closes_at in UTC): the
// helper must give the same close, across both daylight-saving changes and a late-evening start.
const FROM_DATABASE = [
  ['2026-10-31T02:00:00Z', 3, 14, '2026-10-30', '2026-11-15', '2026-11-16T05:00:00Z'],
  ['2027-03-13T01:00:00Z', 3, 1, '2027-03-12', '2027-03-15', '2027-03-16T04:00:00Z'],
  ['2027-03-13T01:00:00Z', 2, 7, '2027-03-12', '2027-03-20', '2027-03-21T04:00:00Z'],
  ['2026-10-31T03:30:00Z', 1, 365, '2026-10-30', '2027-10-30', '2027-10-31T04:00:00Z'],
  ['2026-10-31T04:30:00Z', 2, 30, '2026-10-31', '2026-12-01', '2026-12-02T05:00:00Z'],
  ['2026-11-01T05:30:00Z', 1, 1, '2026-11-01', '2026-11-02', '2026-11-03T05:00:00Z']
];

const dayText = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('getFeedbackWindow dates', () => {
  test.each(FROM_DATABASE)('start %s, %i day(s), +%i days closes like the database', (start, duration, days, opensOn, closesOn, closesAt) => {
    const window = getFeedbackWindow({ status: 'ACTIVE', event_start_date: start, duration_days: duration, feedback_days: days }, new Date('2020-01-01T00:00:00Z'));
    expect(dayText(window.closesOn)).toBe(closesOn);
    expect(dayText(window.opensOn)).toBe(opensOn);
    expect(window.closesAt.getTime()).toBe(new Date(closesAt).getTime());
    // The first answerable day is the event's first day: the state flips to open at its midnight.
    const [y, m, d] = opensOn.split('-').map(Number);
    expect(window.state).toBe('not_yet');
    const justAfterOpen = getFeedbackWindow({ status: 'ACTIVE', event_start_date: start, duration_days: duration, feedback_days: days }, new Date(Date.UTC(y, m - 1, d, 12)));
    expect(justAfterOpen.state).toBe('open');
    const dayBefore = getFeedbackWindow({ status: 'ACTIVE', event_start_date: start, duration_days: duration, feedback_days: days }, new Date(Date.UTC(y, m - 1, d - 1, 12)));
    expect(dayBefore.state).toBe('not_yet');
  });

  test('a missing duration counts one day, a missing offset the default 14', () => {
    const window = getFeedbackWindow({ status: 'ACTIVE', event_start_date: '2026-10-31T02:00:00Z' }, new Date('2020-01-01'));
    expect(dayText(window.closesOn)).toBe('2026-11-13');
  });

  test('no start date, or an invalid offset, has no dates', () => {
    expect(getFeedbackWindow({ status: 'ACTIVE', feedback_days: 14 }).closesOn).toBeNull();
    for (const bad of ['', 0, '1.5', 'x']) {
      expect(getFeedbackWindow({ status: 'ACTIVE', event_start_date: '2026-10-31T02:00:00Z', feedback_days: bad }).closesOn).toBeNull();
    }
  });
});

describe('getFeedbackWindow state', () => {
  const event = { status: 'ACTIVE', event_start_date: '2026-10-31T02:00:00Z', duration_days: 3, feedback_days: 14 };
  // The first day is the Toronto day 30 Oct (the start is 31 Oct 02:00Z = 30 Oct 22:00 EDT).
  test('open from the first day, closed from the close instant, to the second', () => {
    expect(getFeedbackWindow(event, new Date('2026-10-30T03:59:59Z')).state).toBe('not_yet');
    expect(getFeedbackWindow(event, new Date('2026-10-30T04:00:00Z')).state).toBe('open');
    expect(getFeedbackWindow(event, new Date('2026-11-02T05:00:00Z')).state).toBe('open'); // the close is unchanged by the earlier opening
    expect(getFeedbackWindow(event, new Date('2026-11-16T04:59:59Z')).state).toBe('open');
    expect(getFeedbackWindow(event, new Date('2026-11-16T05:00:00Z')).state).toBe('closed');
  });
  test('a DRAFT event is never open or closed by date', () => {
    expect(getFeedbackWindow({ ...event, status: 'DRAFT' }, new Date('2027-01-01')).state).toBe('not_yet');
  });
  test('archived, or with the marker set, is closed for good and reports the marker day', () => {
    expect(getFeedbackWindow({ ...event, status: 'ARCHIVED' }, new Date('2026-11-05')).state).toBe('closed');
    const marked = getFeedbackWindow({ ...event, status: 'ACTIVE', feedback_closed_at: '2026-11-16T05:00:00Z', feedback_days: 400 }, new Date('2026-11-05'));
    expect(marked.state).toBe('closed');
    // The scheduled close is a Toronto midnight: the day it closed on is the one before.
    expect(dayText(marked.closedOn)).toBe('2026-11-15');
    const early = getFeedbackWindow({ ...event, feedback_closed_at: '2026-11-05T15:00:00Z' }, new Date('2026-11-06'));
    expect(dayText(early.closedOn)).toBe('2026-11-05');
  });
});

describe('closesOnSave', () => {
  const saved = { status: 'ACTIVE', event_start_date: '2026-10-31T02:00:00Z', duration_days: 3, feedback_days: 14 };
  const now = new Date('2026-11-10T12:00:00Z');
  test('an offset that puts the close in the past closes it on save', () => {
    expect(closesOnSave(saved, { ...saved, feedback_days: 3 }, now)).toBe(true);
    expect(closesOnSave(saved, { ...saved, feedback_days: 30 }, now)).toBe(false);
  });
  test('an already closed feedback has nothing more to close', () => {
    expect(closesOnSave({ ...saved, feedback_closed_at: '2026-11-09T05:00:00Z' }, { ...saved, feedback_closed_at: '2026-11-09T05:00:00Z', feedback_days: 3 }, now)).toBe(false);
  });
});
