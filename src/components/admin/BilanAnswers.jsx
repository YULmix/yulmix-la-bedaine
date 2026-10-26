import { NotebookPen } from 'lucide-react';
import fr from '../../locales/fr.json';
import { groupByCategory } from '../../lib/eventFeedbackAdmin';
import { EmptyState, Tag, cx } from '../ui';
import FeedbackCategoryCard from '../FeedbackCategoryCard';

// The « Bilan » section's comments (#317, restyled by #346, live since #356), before and after the
// close: the eight categories, each a card with a tinted header (icon, title, the count of what it
// lists), its signed comments (author and text) and its private ones (« Anonyme » and text) once
// released. Until then each card says the private ones show from 3 authors, with no count. The card
// itself is FeedbackCategoryCard, shared with the member's retour page (#352). `result` is
// event_feedback_answers()'s (ADR 0029, #354). The counts above them are BilanDashboard's.
//
// Layout (#346, approved): a grid that reads left to right, then down: one column, two from a
// 3xl container, three from 6xl (the page's width, not the window's, ADR 0022); the cards of a
// row stretch to the same height.
//
// Private comments are shown in the order the database returned them (random, ADR 0029), never
// re-sorted, and carry nothing but their text: no id, date or attribute in the DOM. Their React
// key is their index in that random order within the category, which says nothing about who
// wrote them or when. Signed ones carry no date either (#356).

const PrivateNote = ({ closed }) => (
  <p className="mt-auto border-t border-line px-5 py-3 text-sm text-faint">
    {closed ? fr.adminBilanPrivateNeverShown : fr.adminBilanPrivateHidden}
  </p>
);

const CategoryCard = ({ group, released, closed }) => {
  const count = group.signed.length + group.private.length;
  return (
    <FeedbackCategoryCard
      category={group.category}
      titleId={`bilan-category-${group.category}`}
      aside={tone => <span className={cx('font-data text-sm font-medium', tone.text)}>{count}</span>}
    >
      {tone => (
        <>
          {count === 0 ? (
            <p className="p-5 text-sm text-faint">{released ? fr.adminBilanCategoryEmpty : fr.adminBilanCategoryEmptySigned}</p>
          ) : (
            <ul className="space-y-2.5 p-3 sm:p-4">
              {group.signed.map((item, index) => (
                <li key={`signed-${index}`} className="rounded-control bg-raised px-4 py-3">
                  <p className={cx('text-sm font-semibold [overflow-wrap:anywhere]', tone.text)}>{item.author}</p>
                  <p className="mt-1 whitespace-pre-line text-ink [overflow-wrap:anywhere]">{item.text}</p>
                </li>
              ))}
              {group.private.map((text, index) => (
                <li key={`private-${index}`} className="rounded-control bg-raised px-4 py-3">
                  <Tag tone="info">{fr.adminBilanPrivate}</Tag>
                  <p className="mt-1.5 whitespace-pre-line text-ink [overflow-wrap:anywhere]">{text}</p>
                </li>
              ))}
            </ul>
          )}
          {!released && <PrivateNote closed={closed} />}
        </>
      )}
    </FeedbackCategoryCard>
  );
};

const BilanAnswers = ({ result }) => {
  const groups = groupByCategory(result);
  const released = !!result?.released;
  const closed = !!result?.closed;
  const empty = groups.every(group => group.signed.length === 0 && group.private.length === 0);
  if (empty) {
    return (
      <EmptyState icon={NotebookPen} title={released ? fr.adminBilanEmptyTitle : fr.adminBilanEmptySignedTitle}>
        {released ? null : closed ? fr.adminBilanPrivateNeverShown : fr.adminBilanPrivateHidden}
      </EmptyState>
    );
  }
  return (
    <div className="@container">
      <div className="grid gap-4 @3xl:grid-cols-2 @6xl:grid-cols-3">
        {groups.map(group => <CategoryCard key={group.category} group={group} released={released} closed={closed} />)}
      </div>
    </div>
  );
};

export default BilanAnswers;
