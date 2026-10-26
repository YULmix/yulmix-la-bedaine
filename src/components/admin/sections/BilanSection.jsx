import { useEffect, useState } from 'react';
import { LockKeyhole, NotebookPen } from 'lucide-react';
import fr from '../../../locales/fr.json';
import { supabase } from '../../../lib/supabase';
import { refreshEvents, useEvents } from '../../../lib/events';
import { formatDate } from '../../../lib/format';
import { fetchEligibleRegistrationCount, fetchEventFeedbackAnswers } from '../../../lib/eventFeedbackAdmin';
import { Button, EmptyState, Field, Notice, Select, Skeleton } from '../../ui';
import BilanAnswers from '../BilanAnswers';
import { EVENT_STATUS } from '../AdminEvents';
import SectionStatus from './SectionStatus';

// « Bilan » (#317): an event's post-mortem answers, for account admins only (the section registry
// hides it from Comité and Organisateur; event_feedback_answers() refuses them, ADR 0029). An
// event picker (past editions included), then what the database returns: before the close, only
// its date; after it, the answers grouped by category, named ones with their author, anonymous
// ones as « Anonyme » when there are at least 3.
// The answers themselves are BilanAnswers.

const eventOption = (event) => fr.changeHistoryEventOption
  .replace('{theme}', event.theme || fr.historyEmptyValue)
  .replace('{status}', fr[(event.is_active ? EVENT_STATUS.ACTIVE : EVENT_STATUS[event.status] || EVENT_STATUS.DRAFT).key]);

const LoadingAnswers = () => (
  <div aria-busy="true" className="space-y-4">
    <span className="sr-only">{fr.loading}</span>
    <Skeleton className="h-20 rounded-card" />
    <Skeleton className="h-40 rounded-card" />
    <Skeleton className="h-40 rounded-card" />
  </div>
);

const BilanSection = () => {
  const { events, activeEvent, loading, error } = useEvents();
  const [chosenId, setChosenId] = useState('');
  const eventId = (chosenId && events.some(event => event.id === chosenId) ? chosenId : activeEvent?.id || events[0]?.id) || '';
  // What was loaded, for which event: { eventId, result, registrations, error }.
  const [data, setData] = useState({ eventId: null, result: null, registrations: null, error: null });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!eventId) return undefined;
    let current = true;
    (async () => {
      try {
        const result = await fetchEventFeedbackAnswers(supabase, eventId);
        // The registrations are counted only once the answers are readable: before the close the
        // page shows nothing but the date.
        const registrations = result?.closed ? await fetchEligibleRegistrationCount(supabase, eventId) : null;
        if (current) setData({ eventId, result, registrations, error: null });
      } catch (loadError) {
        if (current) setData({ eventId, result: null, registrations: null, error: loadError.message });
      }
    })();
    return () => { current = false; };
  }, [eventId, reloads]);

  if (loading || error) return <SectionStatus loading={loading} error={error} onRetry={refreshEvents} />;
  if (!events.length) return <EmptyState icon={NotebookPen} title={fr.adminBilanNoEvents} />;

  const shown = data.eventId === eventId ? data : null;
  const result = shown?.result;

  return (
    <div className="space-y-6">
      <Field label={fr.adminBilanEventLabel} htmlFor="bilan-event" className="sm:max-w-sm">
        <Select id="bilan-event" value={eventId} onChange={e => setChosenId(e.target.value)}>
          {events.map(event => <option key={event.id} value={event.id}>{eventOption(event)}</option>)}
        </Select>
      </Field>

      <div data-testid="bilan-answers" data-state={!shown ? 'loading' : shown.error ? 'error' : result?.closed ? 'closed' : 'not_closed'}>
        {!shown ? <LoadingAnswers /> : shown.error ? (
          <Notice tone="bad" title={fr.adminLoadError}
            action={<Button variant="secondary" size="sm" onClick={() => setReloads(n => n + 1)}>{fr.retry}</Button>}>
            {shown.error}
          </Notice>
        ) : result?.closed ? (
          <BilanAnswers result={result} registrations={shown.registrations ?? 0} />
        ) : (
          <Notice tone="info" icon={LockKeyhole} title={fr.adminBilanNotClosedTitle}>
            {result?.closes_on
              ? fr.adminBilanNotClosedMessage.replace('{date}', formatDate(result.closes_on))
              : fr.adminBilanNotClosedNoDate}
          </Notice>
        )}
      </div>
    </div>
  );
};

export default BilanSection;
