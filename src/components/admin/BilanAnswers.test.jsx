import { render, screen, within } from '@testing-library/react';
import BilanAnswers from './BilanAnswers';
import fr from '../../locales/fr.json';

// The answers after the close (#317, restyled by #346), from event_feedback_answers()'s result (ADR 0029).
const closed = {
  closed: true,
  closes_on: '2026-10-20',
  closes_at: '2026-10-21T04:00:00+00:00',
  closed_at: '2026-10-21T05:00:00+00:00',
  named: [
    { answers: { welcome: 'Accueil top' }, author: { user_id: 'u1', party_id: 'p1', full_name: 'Alice Tremblay', email: 'alice@test.local' }, created_at: '2026-10-10T12:00:00Z', updated_at: '2026-10-10T12:00:00Z' }
  ],
  anonymous: [{ answers: { welcome: 'Zèbre' } }, { answers: { welcome: 'Abricot' } }, { answers: { welcome: 'Mangue' } }]
};
const category = name => screen.getByRole('region', { name });

test('grouped by category: the named answer with its author, the anonymous ones as « Anonyme », in the database\'s order', () => {
  render(<BilanAnswers result={closed} />);
  const welcome = category(fr.bilanCategoryWelcome);
  const items = within(welcome).getAllByRole('listitem');
  expect(items.map(item => item.textContent)).toEqual([
    'Alice TremblayAccueil top',
    `${fr.adminBilanAnonymous}Zèbre`,
    `${fr.adminBilanAnonymous}Abricot`,
    `${fr.adminBilanAnonymous}Mangue`
  ]);
  // Every category, in order, with its count; an empty one says so.
  expect(screen.getAllByRole('region').map(region => region.getAttribute('aria-labelledby')))
    .toEqual(['welcome', 'party_music', 'safety', 'lodging', 'food', 'communications', 'schedule', 'other'].map(c => `bilan-category-${c}`));
  expect(within(welcome).getByText('4')).toBeInTheDocument();
  expect(within(category(fr.bilanCategoryFood)).getByText(fr.adminBilanCategoryEmpty)).toBeInTheDocument();
  expect(within(category(fr.bilanCategoryFood)).getByText('0')).toBeInTheDocument();
});

test('the anonymous answers carry no id, date or attribute in the DOM', () => {
  const { container } = render(<BilanAnswers result={closed} />);
  const anonymous = screen.getByText('Zèbre').closest('li');
  expect(anonymous.attributes).toHaveLength(1); // class only
  expect(container.innerHTML).not.toMatch(/u1|p1|2026-10-10/);
});

// The database returns `anonymous: []` for 0, 1 and 2 anonymous answers: none listed.
test('no anonymous answers shown: the named ones only', () => {
  render(<BilanAnswers result={{ ...closed, anonymous: [] }} />);
  const welcome = category(fr.bilanCategoryWelcome);
  expect(within(welcome).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Alice TremblayAccueil top']);
  expect(within(welcome).queryByText(fr.adminBilanAnonymous)).toBeNull();
});

test('no answer at all: the empty state, no category', () => {
  render(<BilanAnswers result={{ ...closed, named: [], anonymous: [] }} />);
  expect(screen.getByText(fr.adminBilanEmptyTitle)).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: fr.bilanCategoryWelcome })).toBeNull();
});
