import { render, screen, within } from '@testing-library/react';
import BilanDashboard from './BilanDashboard';
import fr from '../../locales/fr.json';
import { FEEDBACK_CATEGORIES } from '../../lib/eventFeedback';

// The « Bilan » counts (#346, reworked for items by #356), from event_feedback_counts()'s shape (#354, ADR 0029).
const perCategory = (signed, privateCounts) => FEEDBACK_CATEGORIES.map((category, index) => ({
  category, signed: signed[index], private: privateCounts ? privateCounts[index] : null
}));
const hidden = {
  closed: false, closes_on: '2026-11-15', eligible: 86, signed_members: 23, released: false,
  categories: perCategory([5, 4, 3, 2, 1, 0, 0, 1]), signed_total: 16, private_total: null
};
const shown = {
  ...hidden, released: true,
  categories: perCategory([5, 4, 3, 2, 1, 0, 0, 1], [2, 0, 1, 0, 3, 0, 0, 1]), private_total: 7
};
const OPEN = fr.adminBilanCountsOpenUntil.replace('{date}', '15 novembre 2026');
const cell = label => screen.getByText(label, { selector: 'p' }).parentElement;

test('before the release: the signed comments, « moins de 3 » private, the members who signed over the eligible', () => {
  render(<BilanDashboard counts={hidden} closed={false} status={OPEN} />);
  const card = screen.getByRole('region', { name: fr.adminBilanCountsTitle });
  expect(within(card).getByText(OPEN)).toBeInTheDocument();
  expect(within(cell(fr.adminBilanCountsSigned)).getByText('16')).toBeInTheDocument();
  expect(cell(fr.adminBilanCountsPrivate)).toHaveTextContent(fr.adminBilanCountsPrivateHidden + fr.adminBilanCountsPrivateHiddenHint);
  // 23 / 86 = 27 %.
  expect(cell(fr.adminBilanCountsMembers)).toHaveTextContent(`23 ${fr.adminBilanCountsMembersOf.replace('{n}', 86)}`);
  expect(cell(fr.adminBilanCountsMembers)).toHaveTextContent(fr.adminBilanCountsMembersHint.replace('{rate}', 27));
  const bar = screen.getByRole('img', { name: fr.adminBilanCountsBar.replace('{n}', 23).replace('{eligible}', 86).replace('{rate}', 27) });
  expect(bar.querySelector('span').style.width).toMatch(/^26\.7\d*%$/);
  // No breakdown per category (#363).
  expect(screen.queryByText(fr.bilanCategoryWelcome)).toBeNull();
  expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  // No total adding signed and private up.
  expect(screen.queryByText('16 + ')).toBeNull();
});

test('released: the private count', () => {
  render(<BilanDashboard counts={shown} closed={false} status={OPEN} />);
  expect(cell(fr.adminBilanCountsPrivate)).toHaveTextContent('7' + fr.adminBilanCountsPrivateHint);
  expect(screen.queryByText(fr.adminBilanCountsPrivateHidden)).toBeNull();
});

test('no comment yet: 0, « moins de 3 », 0 sur 1', () => {
  render(<BilanDashboard counts={{ ...hidden, eligible: 1, signed_members: 0, signed_total: 0, categories: perCategory([0, 0, 0, 0, 0, 0, 0, 0]) }} closed={false} status={OPEN} />);
  expect(within(cell(fr.adminBilanCountsSigned)).getByText('0')).toBeInTheDocument();
  expect(cell(fr.adminBilanCountsMembers)).toHaveTextContent(`0 ${fr.adminBilanCountsMembersOf.replace('{n}', 1)}`);
  expect(cell(fr.adminBilanCountsMembers)).toHaveTextContent(fr.adminBilanCountsMembersHint.replace('{rate}', 0));
});

test('no eligible registration: the title and the tag, a sentence, no figure', () => {
  render(<BilanDashboard counts={{ ...hidden, eligible: 0, signed_members: 0 }} closed={false} status={fr.adminBilanCountsOpen} />);
  expect(screen.getByText(fr.adminBilanCountsNoEligible)).toBeInTheDocument();
  expect(screen.getByText(fr.adminBilanCountsOpen)).toBeInTheDocument();
  expect(screen.queryByText(fr.adminBilanCountsSigned)).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
});

test('after the close: the tag passed in', () => {
  const status = fr.adminBilanCountsClosedOn.replace('{date}', '15 novembre 2026');
  render(<BilanDashboard counts={{ ...shown, closed: true }} closed status={status} />);
  expect(screen.getByText(status)).toBeInTheDocument();
});

test('no time of any kind', () => {
  const { container } = render(<BilanDashboard counts={shown} closed={false} status="" />);
  expect(container.innerHTML).not.toMatch(/\d{1,2}:\d{2}|2026|<time/);
});
