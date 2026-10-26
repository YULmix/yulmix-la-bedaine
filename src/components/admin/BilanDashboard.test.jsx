import { render, screen, within } from '@testing-library/react';
import BilanDashboard from './BilanDashboard';
import fr from '../../locales/fr.json';

// The « Bilan » counts (#346), from event_feedback_counts()'s shape (ADR 0029).
const before = { closed: false, closes_on: '2026-11-15', eligible: 86, signed: 23, anonymous: null, total: null };
const cell = label => screen.getByText(label, { selector: 'p' }).parentElement;

test('before the close, fewer than 3 anonymous: « moins de 3 », the signed rate only', () => {
  render(<BilanDashboard counts={before} closedOn={null} />);
  const card = screen.getByRole('region', { name: fr.adminBilanCountsTitle });
  expect(within(card).getByText(fr.adminBilanCountsBeforeClose)).toBeInTheDocument();
  expect(within(cell(fr.adminBilanCountsSigned)).getByText('23')).toBeInTheDocument();
  expect(within(cell(fr.adminBilanCountsAnonymous)).getByText(fr.adminBilanCountsAnonymousHidden)).toBeInTheDocument();
  expect(within(cell(fr.adminBilanCountsAnonymous)).getByText(fr.adminBilanCountsAnonymousHiddenHint)).toBeInTheDocument();
  // 23 / 86 = 27 %, labelled as the signed answers' rate; no plain « Taux de réponse » cell.
  const rate = cell(fr.adminBilanCountsRateSigned);
  expect(rate).toHaveTextContent('27 %');
  expect(rate).toHaveTextContent(fr.adminBilanCountsEligible.replace('{n}', 86));
  expect(screen.queryByText(fr.adminBilanCountsRate, { selector: 'p' })).toBeNull();
  expect(screen.getByRole('img', { name: fr.adminBilanCountsBarSigned.replace('{rate}', 27) })).toBeInTheDocument();
});

test('3 or more anonymous: their count, the combined rate, a two-part bar', () => {
  render(<BilanDashboard counts={{ ...before, signed: 31, anonymous: 12, total: 43 }} closedOn={null} />);
  expect(within(cell(fr.adminBilanCountsAnonymous)).getByText('12')).toBeInTheDocument();
  expect(within(cell(fr.adminBilanCountsAnonymous)).getByText(fr.adminBilanCountsAnonymousHint)).toBeInTheDocument();
  expect(cell(fr.adminBilanCountsRate)).toHaveTextContent('50 %');
  const bar = screen.getByRole('img', { name: fr.adminBilanCountsBarAll.replace('{rate}', 50) });
  const [signed, anonymous] = bar.querySelectorAll('span');
  expect(signed.style.width).toMatch(/^36\.0\d*%$/);
  expect(anonymous.style.width).toMatch(/^13\.9\d*%$/);
});

test('no answer yet: 0, « moins de 3 », 0 %', () => {
  render(<BilanDashboard counts={{ ...before, signed: 0 }} closedOn={null} />);
  expect(within(cell(fr.adminBilanCountsSigned)).getByText('0')).toBeInTheDocument();
  expect(within(cell(fr.adminBilanCountsAnonymous)).getByText(fr.adminBilanCountsAnonymousHidden)).toBeInTheDocument();
  expect(cell(fr.adminBilanCountsRateSigned)).toHaveTextContent('0 %');
});

test('no eligible registration: the title and the tag, a sentence, no figure', () => {
  render(<BilanDashboard counts={{ ...before, eligible: 0, signed: 0 }} closedOn={null} />);
  expect(screen.getByText(fr.adminBilanCountsNoEligible)).toBeInTheDocument();
  expect(screen.getByText(fr.adminBilanCountsBeforeClose)).toBeInTheDocument();
  expect(screen.queryByText(fr.adminBilanCountsSigned)).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
});

test('after the close: « Clos le » and its date; one registration in the singular', () => {
  render(<BilanDashboard counts={{ ...before, closed: true, eligible: 1, signed: 1 }} closedOn="15 novembre 2026" />);
  expect(screen.getByText(fr.adminBilanCountsClosedOn.replace('{date}', '15 novembre 2026'))).toBeInTheDocument();
  expect(screen.queryByText(fr.adminBilanCountsBeforeClose)).toBeNull();
  expect(cell(fr.adminBilanCountsRateSigned)).toHaveTextContent(fr.adminBilanCountsEligibleOne);
  expect(cell(fr.adminBilanCountsRateSigned)).toHaveTextContent('100 %');
});

test('no time of any kind: nothing but the close date', () => {
  const { container } = render(<BilanDashboard counts={{ ...before, signed: 31, anonymous: 12, total: 43 }} closedOn={null} />);
  expect(container.innerHTML).not.toMatch(/\d{1,2}:\d{2}|2026|<time/);
});
