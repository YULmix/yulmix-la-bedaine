import { useEffect, useState } from 'react';
import { NotebookPen } from 'lucide-react';
import fr from '../../../locales/fr.json';
import { supabase } from '../../../lib/supabase';
import { refreshEvents, useEvents } from '../../../lib/events';
import { formatDate } from '../../../lib/format';
import { eventDay } from '../../../lib/eventTime';
import { fetchEventFeedbackAnswers, fetchEventFeedbackCounts } from '../../../lib/eventFeedbackAdmin';
import { Button, EmptyState, Field, Notice, Select, Skeleton } from '../../ui';
import BilanAnswers from '../BilanAnswers';
import BilanDashboard from '../BilanDashboard';
import { EVENT_STATUS } from '../AdminEvents';
import SectionStatus from './SectionStatus';

// « Bilan » (#317): an event's post-mortem comments, for account admins only (the section registry
// hides it from Comité and Organisateur; event_feedback_answers() and event_feedback_counts()
// refuse them, ADR 0029). An event picker (past editions included), then what the database
// returns, the same screen before and after the close (#356): the counts (event_feedback_counts())
// as a dashboard, its tag saying whether the window is open (until its date) or closed, then the
// comments by category (event_feedback_answers()), signed ones live with their author and no date,
// private ones once 3 different members have written one. The counts are BilanDashboard, the
// comments BilanAnswers.
//
// Both load with the section, on a change of edition and on « Réessayer » only: no polling, no
// Realtime, nothing that would date a comment (#346, #356's threat model). The registry declares
// Bilan dense: the comments take the full width (ADR 0022's amendment).

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
  // What was loaded, for which event: { eventId, counts, result, error }.
  const [data, setData] = useState({ eventId: null, counts: null, result: null, error: null });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!eventId) return undefined;
    let current = true;
    (async () => {
      try {
        const [counts, result] = await Promise.all([
          fetchEventFeedbackCounts(supabase, eventId),
          fetchEventFeedbackAnswers(supabase, eventId)
        ]);
        if (current) setData({ eventId, counts, result, error: null });
      } catch (loadError) {
        if (current) setData({ eventId, counts: null, result: null, error: loadError.message });
      }
    })();
    return () => { current = false; };
  }, [eventId, reloads]);

  if (loading || error) return <SectionStatus loading={loading} error={error} onRetry={refreshEvents} />;
  if (!events.length) return <EmptyState icon={NotebookPen} title={fr.adminBilanNoEvents} />;

  const shown = data.eventId === eventId ? data : null;
  const result = shown?.result;
  const closed = !!result?.closed;
  const closesOn = result?.closes_on ?? shown?.counts?.closes_on;
  const status = closed
    ? fr.adminBilanCountsClosedOn.replace('{date}', formatDate(eventDay(result.closed_at)))
    : closesOn ? fr.adminBilanCountsOpenUntil.replace('{date}', formatDate(closesOn)) : fr.adminBilanCountsOpen;

  return (
    <div className="space-y-6">
      <Field label={fr.adminBilanEventLabel} htmlFor="bilan-event" className="sm:max-w-sm">
        <Select id="bilan-event" value={eventId} onChange={e => setChosenId(e.target.value)}>
          {events.map(event => <option key={event.id} value={event.id}>{eventOption(event)}</option>)}
        </Select>
      </Field>

      <div data-testid="bilan-answers" data-state={!shown ? 'loading' : shown.error ? 'error' : closed ? 'closed' : 'open'}>
        {!shown ? <LoadingAnswers /> : shown.error ? (
          <Notice tone="bad" title={fr.adminLoadError} className="max-w-3xl"
            action={<Button variant="secondary" size="sm" onClick={() => setReloads(n => n + 1)}>{fr.retry}</Button>}>
            {shown.error}
          </Notice>
        ) : (
          <div className="space-y-4">
            <BilanDashboard counts={shown.counts} closed={closed} status={status} />
            <BilanAnswers result={result} />
          </div>
        )}
      </div>
    </div>
  );
};

export default BilanSection;
