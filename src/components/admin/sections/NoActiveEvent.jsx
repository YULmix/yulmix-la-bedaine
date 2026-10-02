import { CalendarRange } from 'lucide-react';
import fr from '../../../locales/fr.json';
import { EmptyState } from '../../ui';

// What a section about the active event shows when there is none.
const NoActiveEvent = () => <EmptyState icon={CalendarRange} title={fr.noActiveEventTitle}>{fr.adminNoActiveEventHint}</EmptyState>;

export default NoActiveEvent;
