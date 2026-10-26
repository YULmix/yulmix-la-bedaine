import { NotebookPen } from 'lucide-react';
import fr from '../../locales/fr.json';
import { formatDate } from '../../lib/format';
import { eventDay } from '../../lib/eventTime';
import { categoryLabel } from '../../lib/eventFeedback';
import { answerCounts, groupByCategory } from '../../lib/eventFeedbackAdmin';
import { Card, EmptyState, Tag } from '../ui';

// The « Bilan » section's answers after the close (#317): the counts, then the eight categories,
// each with its named answers (author and text) and its anonymous ones (« Anonyme » and text).
// `result` is event_feedback_answers()'s (ADR 0029), `registrations` the eligible count.
//
// Anonymous answers are shown in the order the database returned them (random, ADR 0029), never
// re-sorted, and carry nothing but their text: no id, date or attribute in the DOM. Their React
// key is their index in that random order within the category, which says nothing about who
// wrote them or when.

const CategoryCard = ({ group }) => {
  const titleId = `bilan-category-${group.category}`;
  const empty = group.named.length === 0 && group.anonymous.length === 0;
  return (
    <Card className="p-5 sm:p-6" aria-labelledby={titleId}>
      <h2 id={titleId} className="text-lg font-semibold text-ink">{categoryLabel(group.category)}</h2>
      {empty ? (
        <p className="mt-2 text-sm text-faint">{fr.adminBilanCategoryEmpty}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {group.named.map((answer, index) => (
            <li key={`named-${index}`} className="py-3 first:pt-0 last:pb-0">
              <p className="text-sm font-semibold text-muted [overflow-wrap:anywhere]">{answer.author}</p>
              <p className="mt-1 whitespace-pre-line text-ink [overflow-wrap:anywhere]">{answer.text}</p>
            </li>
          ))}
          {group.anonymous.map((text, index) => (
            <li key={`anonymous-${index}`} className="py-3 first:pt-0 last:pb-0">
              <Tag>{fr.adminBilanAnonymous}</Tag>
              <p className="mt-1.5 whitespace-pre-line text-ink [overflow-wrap:anywhere]">{text}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

const BilanAnswers = ({ result, registrations }) => {
  const counts = answerCounts(result);
  const groups = groupByCategory(result);
  return (
    <div className="space-y-4">
      <Card className="space-y-1 p-5 sm:p-6" data-testid="bilan-summary">
        <p className="text-sm text-faint">{fr.adminBilanClosedOn.replace('{date}', formatDate(eventDay(result.closed_at)))}</p>
        <p className="font-semibold text-ink">
          {fr.adminBilanNamedCount.replace('{named}', counts.named).replace('{registrations}', registrations)}
        </p>
        {counts.anonymous > 0
          ? <p className="font-semibold text-ink">{fr.adminBilanAnonymousCount.replace('{n}', counts.anonymous)}</p>
          : <p className="text-muted">{fr.adminBilanAnonymousHidden}</p>}
      </Card>
      {counts.named === 0 && counts.anonymous === 0
        ? <EmptyState icon={NotebookPen} title={fr.adminBilanEmptyTitle} />
        : groups.map(group => <CategoryCard key={group.category} group={group} />)}
    </div>
  );
};

export default BilanAnswers;
