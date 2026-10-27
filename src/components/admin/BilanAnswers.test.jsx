import { render, screen, within } from '@testing-library/react';
import BilanAnswers from './BilanAnswers';
import fr from '../../locales/fr.json';

// The comments by category (#317, restyled by #346, live since #356), from
// event_feedback_answers()'s result (#354, ADR 0029): the same before and after the close.
const released = {
  closed: false,
  closes_on: '2026-10-20',
  closes_at: '2026-10-21T04:00:00+00:00',
  closed_at: null,
  released: true,
  signed: [
    { category: 'welcome', text: 'Accueil top', author: { id: 'u1', party: 'p1', name: 'Alice Tremblay', email: 'alice@test.local' } }
  ],
  private: [{ category: 'welcome', text: 'Zèbre' }, { category: 'welcome', text: 'Abricot' }, { category: 'welcome', text: 'Mangue' }]
};
const category = name => screen.getByRole('region', { name });

test('released: the signed comment with its author, the private ones as « Anonyme », in the database\'s order', () => {
  render(<BilanAnswers result={released} />);
  const welcome = category(fr.bilanCategoryWelcome);
  const items = within(welcome).getAllByRole('listitem');
  expect(items.map(item => item.textContent)).toEqual([
    'Alice TremblayAccueil top',
    `${fr.adminBilanPrivate}Zèbre`,
    `${fr.adminBilanPrivate}Abricot`,
    `${fr.adminBilanPrivate}Mangue`
  ]);
  // Every category, in order, with its count; an empty one says so; no threshold note.
  expect(screen.getAllByRole('region').map(region => region.getAttribute('aria-labelledby')))
    .toEqual(['welcome', 'party_music', 'safety', 'lodging', 'food', 'communications', 'schedule', 'other'].map(c => `bilan-category-${c}`));
  expect(within(welcome).getByText('4')).toBeInTheDocument();
  expect(within(category(fr.bilanCategoryFood)).getByText(fr.adminBilanCategoryEmpty)).toBeInTheDocument();
  expect(within(category(fr.bilanCategoryFood)).getByText('0')).toBeInTheDocument();
  expect(screen.queryByText(fr.adminBilanPrivateHidden)).toBeNull();
});

test('the private comments carry no id, date or attribute in the DOM; nothing carries a time', () => {
  const { container } = render(<BilanAnswers result={released} />);
  const item = screen.getByText('Zèbre').closest('li');
  expect(item.attributes).toHaveLength(1); // class only
  expect(container.innerHTML).not.toMatch(/u1|p1|alice@test\.local|2026|\d{1,2}:\d{2}|<time/);
});

// Before the release the database returns `private: []`: none listed, and every card says when they show, with no count.
test('not released, before the close: the signed comments only, and each card says private ones show from 3 members', () => {
  render(<BilanAnswers result={{ ...released, released: false, private: [] }} />);
  const welcome = category(fr.bilanCategoryWelcome);
  expect(within(welcome).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Alice TremblayAccueil top']);
  expect(within(welcome).queryByText(fr.adminBilanPrivate)).toBeNull();
  expect(within(welcome).getByText('1')).toBeInTheDocument();
  expect(screen.getAllByText(fr.adminBilanPrivateHidden)).toHaveLength(8);
  expect(within(category(fr.bilanCategoryFood)).getByText(fr.adminBilanCategoryEmptySigned)).toBeInTheDocument();
});

test('closed without a release: the private ones stay hidden, and the cards say so', () => {
  render(<BilanAnswers result={{ ...released, closed: true, released: false, private: [] }} />);
  expect(screen.getAllByText(fr.adminBilanPrivateNeverShown)).toHaveLength(8);
  expect(screen.queryByText(fr.adminBilanPrivateHidden)).toBeNull();
});

test('no comment at all: the empty state, no category; before the release, when the private ones show', () => {
  const { rerender } = render(<BilanAnswers result={{ ...released, signed: [], private: [] }} />);
  expect(screen.getByText(fr.adminBilanEmptyTitle)).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: fr.bilanCategoryWelcome })).toBeNull();
  rerender(<BilanAnswers result={{ ...released, released: false, signed: [], private: [] }} />);
  expect(screen.getByText(fr.adminBilanEmptySignedTitle)).toBeInTheDocument();
  expect(screen.getByText(fr.adminBilanPrivateHidden)).toBeInTheDocument();
});
