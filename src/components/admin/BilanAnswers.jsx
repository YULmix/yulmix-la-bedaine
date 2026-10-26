import { BedDouble, Clock, HeartHandshake, Megaphone, MessageSquare, Music, NotebookPen, ShieldCheck, Utensils } from 'lucide-react';
import fr from '../../locales/fr.json';
import { categoryLabel } from '../../lib/eventFeedback';
import { groupByCategory } from '../../lib/eventFeedbackAdmin';
import { Card, EmptyState, Tag, cx } from '../ui';

// The « Bilan » section's answers after the close (#317, restyled by #346): the eight categories,
// each a card with a tinted header (icon, title, count), its named answers (author and text) and
// its anonymous ones (« Anonyme » and text). `result` is event_feedback_answers()'s (ADR 0029).
// The counts above them are BilanDashboard's.
//
// Layout (#346, approved): a grid that reads left to right, then down: one column, two from a
// 3xl container, three from 6xl (the page's width, not the window's, ADR 0022); the cards of a
// row stretch to the same height.
//
// Anonymous answers are shown in the order the database returned them (random, ADR 0029), never
// re-sorted, and carry nothing but their text: no id, date or attribute in the DOM. Their React
// key is their index in that random order within the category, which says nothing about who
// wrote them or when.

const ICONS = {
  welcome: HeartHandshake,
  party_music: Music,
  safety: ShieldCheck,
  lodging: BedDouble,
  food: Utensils,
  communications: Megaphone,
  schedule: Clock,
  other: MessageSquare
};

// The categories' colours, cycling in display order.
const TONES = [
  { head: 'tint-neon', chip: 'bg-neon text-night', text: 'text-neon' },
  { head: 'tint-info', chip: 'bg-info text-night', text: 'text-info' },
  { head: 'tint-ok', chip: 'bg-ok text-night', text: 'text-ok' },
  { head: 'tint-warn', chip: 'bg-warn text-night', text: 'text-warn' }
];

const CategoryCard = ({ group, tone }) => {
  const titleId = `bilan-category-${group.category}`;
  const count = group.named.length + group.anonymous.length;
  const Icon = ICONS[group.category] ?? MessageSquare;
  return (
    <Card className="flex flex-col overflow-hidden" aria-labelledby={titleId}>
      <div className={cx('flex items-center gap-3 border-b border-line px-5 py-3.5', tone.head)}>
        <span className={cx('grid size-9 shrink-0 place-items-center rounded-control', tone.chip)}>
          <Icon aria-hidden="true" className="size-5" strokeWidth={2} />
        </span>
        <h2 id={titleId} className="min-w-0 flex-1 text-lg font-semibold text-ink">{categoryLabel(group.category)}</h2>
        <span className={cx('font-data text-sm font-medium', tone.text)}>{count}</span>
      </div>
      {count === 0 ? (
        <p className="p-5 text-sm text-faint">{fr.adminBilanCategoryEmpty}</p>
      ) : (
        <ul className="space-y-2.5 p-3 sm:p-4">
          {group.named.map((answer, index) => (
            <li key={`named-${index}`} className="rounded-control bg-raised px-4 py-3">
              <p className={cx('text-sm font-semibold [overflow-wrap:anywhere]', tone.text)}>{answer.author}</p>
              <p className="mt-1 whitespace-pre-line text-ink [overflow-wrap:anywhere]">{answer.text}</p>
            </li>
          ))}
          {group.anonymous.map((text, index) => (
            <li key={`anonymous-${index}`} className="rounded-control bg-raised px-4 py-3">
              <Tag tone="info">{fr.adminBilanAnonymous}</Tag>
              <p className="mt-1.5 whitespace-pre-line text-ink [overflow-wrap:anywhere]">{text}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

const BilanAnswers = ({ result }) => {
  const groups = groupByCategory(result);
  const empty = groups.every(group => group.named.length === 0 && group.anonymous.length === 0);
  if (empty) return <EmptyState icon={NotebookPen} title={fr.adminBilanEmptyTitle} />;
  return (
    <div className="@container">
      <div className="grid gap-4 @3xl:grid-cols-2 @6xl:grid-cols-3">
        {groups.map((group, index) => <CategoryCard key={group.category} group={group} tone={TONES[index % TONES.length]} />)}
      </div>
    </div>
  );
};

export default BilanAnswers;
