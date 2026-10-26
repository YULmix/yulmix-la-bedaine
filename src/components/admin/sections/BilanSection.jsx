import { useEffect, useState } from 'react';
import { LockKeyhole, NotebookPen } from 'lucide-react';
import fr from '../../../locales/fr.json';
import { supabase } from '../../../lib/supabase';
import { refreshEvents, useEvents } from '../../../lib/events';
import { formatDate } from '../../../lib/format';
import { eventDay } from '../../../lib/eventTime';
import { fetchEventFeedbackAnswers, fetchEventFeedbackCounts, shownCounts } from '../../../lib/eventFeedbackAdmin';
import { Button, EmptyState, Field, Notice, Select, Skeleton, cx } from '../../ui';
import BilanAnswers from '../BilanAnswers';
import BilanDashboard from '../BilanDashboard';
import { EVENT_STATUS } from '../AdminEvents';
import SectionStatus from './SectionStatus';

// « Bilan » (#317): an event's post-mortem answers, for account admins only (the section registry
// hides it from Comité and Organisateur; event_feedback_answers() refuses them, ADR 0029). An
// event picker (past editions included), then what the database returns: the counts
// (event_feedback_counts(), #345/#346) as a dashboard, then before the close only the close's
// date, after it the answers grouped by category, named ones with their author, anonymous ones as
// « Anonyme » when there are at least 3. The counts are BilanDashboard, the answers BilanAnswers.
//
// Counts load with the section, on a change of edition and on « Réessayer » only: no polling, no
// Realtime, nothing that would date an answer (#346's threat model). Before the close the page is
// narrow; after it the answers take the full width, the counts staying narrow above them
// (#346, ADR 0022's amendment): the registry declares Bilan dense, and this narrows itself.

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
        const counts = await fetchEventFeedbackCounts(supabase, eventId);
        // The answers only once they're readable: before the close the database returns none.
        const result = counts.closed ? await fetchEventFeedbackAnswers(supabase, eventId) : null;
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
  const closed = !!shown?.counts?.closed && !!result?.closed;
  const closesOn = shown?.counts?.closes_on;

  return (
    <div className={cx('space-y-6', !closed && 'max-w-3xl')}>
      <Field label={fr.adminBilanEventLabel} htmlFor="bilan-event" className="sm:max-w-sm">
        <Select id="bilan-event" value={eventId} onChange={e => setChosenId(e.target.value)}>
          {events.map(event => <option key={event.id} value={event.id}>{eventOption(event)}</option>)}
        </Select>
      </Field>

      <div data-testid="bilan-answers" data-state={!shown ? 'loading' : shown.error ? 'error' : closed ? 'closed' : 'not_closed'}>
        {!shown ? <LoadingAnswers /> : shown.error ? (
          <Notice tone="bad" title={fr.adminLoadError}
            action={<Button variant="secondary" size="sm" onClick={() => setReloads(n => n + 1)}>{fr.retry}</Button>}>
            {shown.error}
          </Notice>
        ) : (
          <div className="space-y-4">
            <div className="max-w-3xl">
              <BilanDashboard counts={shownCounts(shown.counts, result)}
                closedOn={closed ? formatDate(eventDay(result.closed_at)) : null} />
            </div>
            {closed ? <BilanAnswers result={result} /> : (
              <Notice tone="info" icon={LockKeyhole} title={fr.adminBilanNotClosedTitle}>
                {closesOn
                  ? fr.adminBilanNotClosedMessage.replace('{date}', formatDate(closesOn))
                  : fr.adminBilanNotClosedNoDate}
              </Notice>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default BilanSection;
