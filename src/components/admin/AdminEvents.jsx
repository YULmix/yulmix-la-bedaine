import { Archive, CalendarPlus, Pencil, Power } from 'lucide-react';
import fr from '../../locales/fr.json';
import { formatEventDates } from '../../lib/eventDisplay';
import { Button, EmptyState, Tag } from '../ui';

export const EVENT_STATUS = {
  ACTIVE: { tone: 'ok', key: 'eventStatusActive' },
  ARCHIVED: { tone: 'neutral', key: 'eventStatusArchived' },
  DRAFT: { tone: 'info', key: 'draft' }
};

// Event list with lifecycle actions (activate / archive / edit). The only-one-active rule lives
// in the database (only_one_active_event); the UI checks first and reports the constraint error.
// Editing opens the event editor page (EventEditor); an event with an unsaved draft says so.
export const AdminEventList = ({ events, draftEventId, onActivate, onArchive, onEdit }) => (
  <section className="space-y-4">
    <h2 className="text-xl font-semibold text-ink">{fr.adminEventsManagementTitle}</h2>
    {events.length === 0 ? (
      <EmptyState icon={CalendarPlus} title={fr.noEventsYet} />
    ) : (
      <ul className="overflow-hidden rounded-card border border-line bg-surface divide-y divide-line">
        {events.map(event => {
          const status = EVENT_STATUS[event.status] || EVENT_STATUS.DRAFT;
          const dates = formatEventDates(event);
          return (
            <li key={event.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-5 sm:px-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-ink">{event.theme}</p>
                  <Tag tone={status.tone}>{fr[status.key]}</Tag>
                  {event.is_active && event.is_reg_open && <Tag tone="neon">{fr.eventRegOpenLabel}</Tag>}
                  {event.id === draftEventId && <Tag tone="warn">{fr.unsavedTag}</Tag>}
                </div>
                {dates && <p className="mt-1 font-data text-xs text-faint">{dates}</p>}
                {event.description && <p className="mt-1 line-clamp-1 text-sm text-muted">{event.description}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {!event.is_active && event.status !== 'ARCHIVED' && (
                  <Button size="sm" onClick={() => onActivate(event)}>
                    <Power aria-hidden="true" className="size-4" />{fr.activateEventButton}
                  </Button>
                )}
                {event.is_active && (
                  <Button size="sm" variant="secondary" onClick={() => onEdit(event)}>
                    <Pencil aria-hidden="true" className="size-4" />{fr.edit}
                  </Button>
                )}
                {event.is_active && (
                  <Button size="sm" variant="ghost" onClick={() => onArchive(event)}>
                    <Archive aria-hidden="true" className="size-4" />{fr.archiveEventButton}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    )}
  </section>
);
