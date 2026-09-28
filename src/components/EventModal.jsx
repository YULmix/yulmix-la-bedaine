import fr from '../locales/fr.json';
import EventFacts from './EventFacts';
import { Dialog, Tag } from './ui';

const STATUS = {
  ARCHIVED: { tone: 'neutral', key: 'eventStatusArchived' },
  DRAFT: { tone: 'info', key: 'draft' },
  ACTIVE: { tone: 'ok', key: 'eventStatusActive' }
};

// Details of another (usually past) edition, opened from the home page's strip.
const EventModal = ({ event, isOpen, onClose }) => {
  const status = event ? STATUS[event.status] : null;
  return (
    <Dialog open={isOpen && !!event} onClose={onClose} title={event?.theme || fr.eventDetails} size="md">
      {event && (
        <div className="space-y-6 px-5 py-5 sm:px-6">
          <div className="space-y-3">
            {status && <Tag tone={status.tone}>{fr[status.key]}</Tag>}
            {event.description && <p className="max-w-prose text-muted">{event.description}</p>}
          </div>
          <EventFacts event={event} />
        </div>
      )}
    </Dialog>
  );
};

export default EventModal;
