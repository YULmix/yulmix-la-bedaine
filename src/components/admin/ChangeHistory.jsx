import { ArrowRight, ClipboardCopy, Download, History, RotateCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import fr from '../../locales/fr.json';
import { supabase } from '../../lib/supabase';
import { exportFileName, toCsv, toTsv } from '../../lib/dataExport';
import { defaultHistoryEvent, historyEntries, historyExportRows } from '../../lib/changeHistory';
import { Button, Card, EmptyState, Field, Notice, Select, Skeleton, cx } from '../ui';
import { EVENT_STATUS } from './AdminEvents';
import { useFitToViewport } from '../../hooks/useFitToViewport';

// PostgREST returns at most this many rows per request; longer histories are read in slices.
const FETCH_SLICE = 1000;

/** Every registration_edits row of one event, newest first, with whose registration it is. */
const fetchEventEdits = async (eventId) => {
  const edits = [];
  for (let from = 0; ; from += FETCH_SLICE) {
    const { data, error } = await supabase
      .from('registration_edits')
      .select('id, edited_at, edited_by, changes, registration:user_parties!inner(user_id, event_id)')
      .eq('registration.event_id', eventId)
      .order('edited_at', { ascending: false })
      .order('id')
      .range(from, from + FETCH_SLICE - 1);
    if (error) throw error;
    edits.push(...data);
    if (data.length < FETCH_SLICE) return edits;
  }
};

/** Names for every author and registrant, deleted accounts included (admins read all profiles). */
const fetchProfiles = async (edits) => {
  const ids = [...new Set(edits.flatMap(edit => [edit.edited_by, edit.registration?.user_id]).filter(Boolean))];
  const profiles = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from('profiles').select('id, full_name, email').in('id', ids.slice(i, i + 100));
    if (error) throw error;
    data.forEach(profile => profiles.set(profile.id, profile));
  }
  return profiles;
};

const downloadCsv = (csv, fileName) => {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

// « Historique des changements » (#173): one event's registrations and edits, newest first, with a
// CSV download and a copy for Google Sheets of the same rows. Inscrits' « Historique » view
// (#209). Admin only: RLS lets only an admin read other people's entries anyway.
export const ChangeHistory = ({ events, notify }) => {
  const [eventId, setEventId] = useState(() => defaultHistoryEvent(events)?.id ?? '');
  const [entries, setEntries] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [reloads, setReloads] = useState(0);
  const event = events.find(item => item.id === eventId);

  useEffect(() => {
    if (!eventId && events.length) setEventId(defaultHistoryEvent(events)?.id ?? '');
  }, [events, eventId]);

  useEffect(() => {
    if (!eventId) return undefined;
    let current = true;
    setEntries(null);
    setLoadError(null);
    (async () => {
      try {
        const edits = await fetchEventEdits(eventId);
        const profiles = await fetchProfiles(edits);
        if (current) setEntries(historyEntries(edits, profiles));
      } catch (error) {
        console.error('Error loading change history:', error);
        if (current) setLoadError(fr.changeHistoryLoadError);
      }
    })();
    return () => { current = false; };
  }, [eventId, reloads]);

  // The list scrolls inside the card, and the card ends on screen: one scrollbar, not two.
  const scrollRef = useRef(null);
  useFitToViewport(scrollRef, { reserve: 40, deps: [entries] });

  const exportRows = useMemo(() => (entries ? historyExportRows(entries) : null), [entries]);
  const hasRows = !!exportRows?.rows.length;

  const exportCsv = () => {
    downloadCsv(toCsv(exportRows), exportFileName('historique', event?.theme));
    notify(fr.changeHistoryCSVToast, 'success');
  };

  const copyTsv = async () => {
    try {
      await navigator.clipboard.writeText(toTsv(exportRows));
      notify(fr.changeHistoryCopyToast, 'success');
    } catch (error) {
      console.error('Failed to copy change history:', error);
      notify(fr.changeHistoryCopyError, 'error');
    }
  };

  const eventOption = (item) => fr.changeHistoryEventOption
    .replace('{theme}', item.theme || fr.historyEmptyValue)
    .replace('{status}', fr[(item.is_active ? EVENT_STATUS.ACTIVE : EVENT_STATUS[item.status] || EVENT_STATUS.DRAFT).key]);

  const changeLine = (line, index) => (
    <li key={index} className="break-words text-muted">
      <span className="font-semibold text-ink">{line.label}</span>{' '}
      {line.from && (
        <>
          <span>{line.from}</span>
          <ArrowRight aria-label={fr.historyChangedTo} className="mx-1 inline size-3.5 text-faint" />
        </>
      )}
      <span className="text-ink">{line.to}</span>
    </li>
  );

  // Wide screens: one row per entry under a sticky header (when, registration, author, changes).
  // Phones: the same entry stacked.
  const ROW = 'md:grid md:grid-cols-[9rem_minmax(0,12rem)_minmax(0,12rem)_minmax(0,1fr)] md:gap-4';
  return (
    <Card className="flex flex-col p-4 sm:p-5" aria-labelledby="change-history-title">
      {/* The page header already names this screen; the heading is for screen readers. Every
          vertical pixel above the list is one the list can't use. */}
      <h3 id="change-history-title" className="sr-only">{fr.changeHistoryTitle}</h3>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <Field label={fr.changeHistoryEventLabel} htmlFor="change-history-event" className="lg:min-w-80">
          <Select id="change-history-event" value={eventId} onChange={e => setEventId(e.target.value)}>
            {events.map(item => <option key={item.id} value={item.id}>{eventOption(item)}</option>)}
          </Select>
        </Field>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button variant="secondary" onClick={exportCsv} disabled={!hasRows}>
            <Download aria-hidden="true" className="size-4.5" strokeWidth={1.75} />{fr.exportCSVButton}
          </Button>
          <Button variant="secondary" onClick={copyTsv} disabled={!hasRows}>
            <ClipboardCopy aria-hidden="true" className="size-4.5" strokeWidth={1.75} />{fr.exportCopyTSVButton}
          </Button>
        </div>
      </div>

      {loadError ? (
        <Notice tone="bad" className="mt-5"
          action={<Button variant="secondary" size="sm" onClick={() => setReloads(n => n + 1)}><RotateCw aria-hidden="true" className="size-4" />{fr.retry}</Button>}>
          {loadError}
        </Notice>
      ) : entries === null ? (
        <div aria-busy="true" className="mt-5 space-y-3">
          <span className="sr-only">{fr.loading}</span>
          <Skeleton className="h-16 rounded-control" />
          <Skeleton className="h-16 rounded-control" />
        </div>
      ) : entries.length === 0 ? (
        <EmptyState icon={History} title={fr.changeHistoryEmpty} className="mt-5" />
      ) : (
        <>
          <p className="mt-4 text-xs text-faint" aria-live="polite">
            {(entries.length === 1 ? fr.changeHistoryCountOne : fr.changeHistoryCountOther).replace('{count}', entries.length)}
          </p>
          <div
            ref={scrollRef}
            className="mt-2 overflow-y-auto overscroll-contain rounded-control border border-line"
            tabIndex={0}
            role="region"
            aria-label={fr.changeHistoryTitle}
            data-testid="change-history-scroll"
          >
            <div className={cx('sticky top-0 z-10 hidden border-b border-line bg-raised px-4 py-2 text-xs font-semibold uppercase tracking-wide text-faint', ROW)} aria-hidden="true">
              <span>{fr.historyExportTimestamp}</span>
              <span>{fr.historyExportRegistration}</span>
              <span>{fr.historyExportAuthor}</span>
              <span>{fr.changeHistoryChanges}</span>
            </div>
            <ol className="divide-y divide-line">
              {entries.map(entry => (
                <li key={entry.id} className={cx('px-4 py-3 text-sm', ROW)} data-testid="change-history-entry">
                  <p className="font-data text-xs text-faint md:pt-0.5">{entry.at}</p>
                  <p className="font-semibold text-ink break-words">{entry.registrant}</p>
                  <p className="text-faint break-words">
                    <span className="md:hidden">{fr.changeHistoryBy.replace('{author}', entry.author)}</span>
                    <span className="hidden md:inline">{entry.author}</span>
                  </p>
                  {entry.lines.length > 0
                    ? <ul className="mt-1 space-y-1 md:mt-0">{entry.lines.map(changeLine)}</ul>
                    : <p className="mt-1 text-muted md:mt-0">{fr.historyNoDetail}</p>}
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </Card>
  );
};
