import { BedDouble, Clock, HeartHandshake, Megaphone, MessageSquare, Music, ShieldCheck, Utensils } from 'lucide-react';
import { FEEDBACK_CATEGORIES, categoryLabel } from '../lib/eventFeedback';
import { Card, cx } from './ui';

// One post-mortem category as a card (#346's design, shared by #352): a tinted header with the
// category's icon chip and title, then the body its screen passes in. The admin « Bilan » passes the
// answers and a count (BilanAnswers), the member's retour page a textarea, or their own signed
// answer once closed (BilanPage). The icon map and the colour cycle live here only, so both screens
// show a category the same way.

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

// The categories' colours, cycling in display order (FEEDBACK_CATEGORIES): a category keeps its
// colour whichever categories are shown around it.
const TONES = [
  { head: 'tint-neon', chip: 'bg-neon text-night', text: 'text-neon' },
  { head: 'tint-info', chip: 'bg-info text-night', text: 'text-info' },
  { head: 'tint-ok', chip: 'bg-ok text-night', text: 'text-ok' },
  { head: 'tint-warn', chip: 'bg-warn text-night', text: 'text-warn' }
];

export const categoryTone = category => {
  const index = FEEDBACK_CATEGORIES.indexOf(category);
  return TONES[(index < 0 ? 0 : index) % TONES.length];
};

// `titleAs` is the title's element: a heading (h2 on the admin page, h3 under the member page's own
// title) or, for a textarea, its `label` (`titleProps.htmlFor`), so the field keeps the category as
// its accessible name. A card is a named region unless `region` is false (a form field, where eight
// landmarks would only be noise). `aside` sits at the header's end (the admin count). `aside` and `children` may be functions of
// the category's tone, to colour their own parts.
const FeedbackCategoryCard = ({ category, titleId, titleAs: Title = 'h2', titleProps, region = true, aside, children }) => {
  const tone = categoryTone(category);
  const Icon = ICONS[category] ?? MessageSquare;
  return (
    <Card
      as={region ? 'section' : 'div'}
      className="flex flex-col overflow-hidden"
      aria-labelledby={region ? titleId : undefined}
    >
      <div className={cx('flex items-center gap-3 border-b border-line px-5 py-3.5', tone.head)}>
        <span className={cx('grid size-9 shrink-0 place-items-center rounded-control', tone.chip)}>
          <Icon aria-hidden="true" className="size-5" strokeWidth={2} />
        </span>
        <Title id={titleId} {...titleProps} className="min-w-0 flex-1 text-lg font-semibold text-ink">{categoryLabel(category)}</Title>
        {typeof aside === 'function' ? aside(tone) : aside}
      </div>
      {typeof children === 'function' ? children(tone) : children}
    </Card>
  );
};

export default FeedbackCategoryCard;
