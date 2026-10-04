import { useMemo, useRef, useState } from 'react';
import { Info, Search, UsersRound } from 'lucide-react';
import fr from '../../locales/fr.json';
import { attendeeRows, sortAttendees } from '../../lib/dataExport';
import { plural } from '../../lib/eventDisplay';
import { Dialog, EmptyState, Tag, Toggle, cx } from '../ui';
import { useFitToViewport } from '../../hooks/useFitToViewport';
import { AdminHeaderActions } from './AdminNav';

// Inscrits › « Participants » (#262): one row per attendee of the non-cancelled parties, read-only.
// The rows are the export's (attendeeRows), so the two can't drift. Values from a fixed list are
// pills; the free-text answers open in a pop-up, from a « Détails » button only on rows that have some.
const SORTS = [
  { id: 'group', labelKey: 'participantsSortGroup' },
  { id: 'name', labelKey: 'participantsSortName' }
];

const GRID = 'lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_5.5rem_12rem_minmax(0,1.3fr)_minmax(0,1fr)_9rem_6.5rem]';

const ParticipantRow = ({ row, grouped, onDetails }) => {
  const hasDetails = !!(row.dietaryOther || row.sleepingOther);
  return (
    <li className={cx('flex flex-col gap-2 px-4 py-3 lg:grid lg:items-center lg:gap-4 lg:px-5', GRID)}>
      <div className="flex min-w-0 items-center justify-between gap-2 lg:contents">
        <span data-participant-name className="min-w-0 truncate font-semibold text-ink">{row.name || fr.notSpecified}</span>
        {hasDetails && (
          <button
            type="button"
            onClick={() => onDetails(row)}
            aria-label={`${fr.participantsDetails}: ${row.name}`}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-line px-3 text-sm font-semibold text-muted hover:border-edge hover:text-ink lg:order-last lg:justify-self-end"
          >
            <Info aria-hidden="true" className="size-4" />
            {fr.participantsDetails}
          </button>
        )}
      </div>
      {grouped
        ? <span aria-hidden="true" className="hidden lg:block" />
        : <span className="min-w-0 truncate text-sm text-faint lg:text-base lg:text-muted">{row.contact}</span>}
      <div className="flex flex-wrap gap-1.5 lg:contents">
        <Tag>{row.type}</Tag>
        {row.participation ? <Tag>{row.participation}</Tag> : <span className="hidden lg:block" />}
        <div className="contents lg:flex lg:flex-wrap lg:gap-1.5">
          {row.dietary.map(label => <Tag key={label}>{label}</Tag>)}
        </div>
        <div className="contents lg:block">{row.sleeping && <Tag>{row.sleeping}</Tag>}</div>
        <div className="contents lg:flex lg:flex-wrap lg:gap-1.5">
          <Tag tone={row.waitlisted ? 'warn' : 'ok'}>{row.status}</Tag>
          {row.firstTime && <Tag tone="neon">{fr.firstTimeTag}</Tag>}
        </div>
      </div>
    </li>
  );
};

const ParticipantsView = ({ parties }) => {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('group');
  const [grouped, setGrouped] = useState(false);
  const [details, setDetails] = useState(null);
  const listRef = useRef(null);

  const rows = useMemo(() => attendeeRows(parties), [parties]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = needle ? rows.filter(row => [row.name, row.contact].some(v => v.toLowerCase().includes(needle))) : rows;
    return sortAttendees(matching, { key: sort, grouped });
  }, [rows, query, sort, grouped]);
  useFitToViewport(listRef, { deps: [visible] });

  return (
    <section className="space-y-4">
      <AdminHeaderActions>
        <div className="relative w-full sm:w-72">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4.5 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={fr.participantsSearchPlaceholder}
            aria-label={fr.participantsSearchPlaceholder}
            className="min-h-11 w-full rounded-control border border-line bg-surface pl-10 pr-3 text-base text-ink placeholder:text-faint"
          />
        </div>
      </AdminHeaderActions>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-sm text-faint">{plural(visible.length, 'countPersonOne', 'countPersonOther')}</span>
        <div role="group" aria-label={fr.participantsSortLabel} className="flex items-center gap-2">
          <span className="text-sm text-faint">{fr.participantsSortLabel}</span>
          {SORTS.map(({ id, labelKey }) => (
            <button
              key={id}
              type="button"
              aria-pressed={sort === id}
              onClick={() => setSort(id)}
              className={cx(
                'inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-semibold transition duration-150',
                sort === id ? 'border-neon tint-neon text-ink' : 'border-line text-muted hover:border-edge hover:text-ink'
              )}
            >
              {fr[labelKey]}
            </button>
          ))}
        </div>
        <Toggle checked={grouped} onChange={setGrouped} label={fr.participantsGroupBy} className="sm:ml-auto" />
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={UsersRound} title={rows.length ? fr.participantsNone : fr.participantsEmpty} />
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <div className={cx('hidden border-b border-line px-5 py-3 text-sm font-semibold text-faint lg:grid lg:gap-4', GRID)}>
            <span>{fr.exportAttendeeName}</span>
            <span>{grouped ? '' : fr.participantsColumnGroup}</span>
            <span>{fr.exportAttendeeType}</span>
            <span>{fr.exportParticipation}</span>
            <span>{fr.exportDietaryNeeds}</span>
            <span>{fr.exportSleepingPref}</span>
            <span>{fr.exportStatus}</span>
            <span />
          </div>
          <ul ref={listRef} aria-label={fr.participantsListLabel} className="relative divide-y divide-line overflow-y-auto overscroll-contain">
            {visible.map((row, index) => (
              <RowWithHeader key={row.key} row={row} previous={visible[index - 1]} grouped={grouped} onDetails={setDetails} />
            ))}
          </ul>
        </div>
      )}

      <Dialog
        open={!!details}
        onClose={() => setDetails(null)}
        title={details ? fr.participantsDetailsTitle.replace('{name}', details.name || fr.notSpecified) : ''}
      >
        {details && (
          <dl className="space-y-3">
            {details.dietaryOther && (
              <div>
                <dt className="text-sm font-semibold text-faint">{fr.exportDietaryOther}</dt>
                <dd className="whitespace-pre-wrap text-ink">{details.dietaryOther}</dd>
              </div>
            )}
            {details.sleepingOther && (
              <div>
                <dt className="text-sm font-semibold text-faint">{fr.participantsSleepingOther}</dt>
                <dd className="whitespace-pre-wrap text-ink">{details.sleepingOther}</dd>
              </div>
            )}
          </dl>
        )}
      </Dialog>
    </section>
  );
};

// A row, preceded by its group's header when grouped and it starts a new party.
const RowWithHeader = ({ row, previous, grouped, onDetails }) => (
  <>
    {grouped && previous?.partyId !== row.partyId && (
      <li role="presentation" className="bg-raised px-4 py-2 text-sm font-semibold text-muted lg:px-5">
        {fr.participantsGroupOf.replace('{name}', row.contact)}
      </li>
    )}
    <ParticipantRow row={row} grouped={grouped} onDetails={onDetails} />
  </>
);

export default ParticipantsView;
