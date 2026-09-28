import { ChevronRight } from 'lucide-react';
import fr from '../locales/fr.json';
import { formatEventDates } from '../lib/eventDisplay';
import { Tag } from '../components/ui';

const STATUS = {
  ARCHIVED: { tone: 'neutral', key: 'eventStatusArchived' },
  DRAFT: { tone: 'info', key: 'draft' },
  ACTIVE: { tone: 'ok', key: 'eventStatusActive' }
};

// Other editions as a horizontal scroll-snap strip: a row of posters you flick through, instead
// of a grid of identical cards.
const PastEditions = ({ events = [], onEventClick }) => {
  if (!events.length) return null;
  return (
    <section aria-labelledby="past-editions-title">
      <h2 id="past-editions-title" className="mb-4 text-lg font-semibold text-ink">{fr.otherEventsTitle}</h2>
      <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
        {events.map(event => {
          const status = STATUS[event.status] || STATUS.ARCHIVED;
          const dates = formatEventDates(event);
          return (
            <li key={event.id} className="w-64 shrink-0 snap-start sm:w-72">
              <button
                onClick={() => onEventClick(event)}
                className="group flex h-full w-full flex-col gap-3 rounded-card border border-line bg-surface p-5 text-left transition duration-150 hover:border-edge hover:bg-raised"
              >
                <Tag tone={status.tone} className="self-start">{fr[status.key]}</Tag>
                <span className="font-display text-xl leading-tight text-ink">{event.theme}</span>
                {dates && <span className="font-data text-xs text-faint">{dates}</span>}
                {event.description && <span className="line-clamp-2 text-sm text-muted">{event.description}</span>}
                <span className="mt-auto inline-flex items-center gap-1 text-sm font-semibold text-neon">
                  {fr.viewDetails}
                  <ChevronRight aria-hidden="true" className="size-4 transition group-hover:translate-x-0.5" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default PastEditions;
