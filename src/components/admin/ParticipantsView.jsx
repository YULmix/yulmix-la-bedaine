import { Fragment, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Info, Search, UsersRound, Utensils } from 'lucide-react';
import fr from '../../locales/fr.json';
import { attendeeRows, sortAttendees } from '../../lib/dataExport';
import { plural } from '../../lib/eventDisplay';
import { Button, ChipGroup, Dialog, EmptyState, Tag, Toggle, cx } from '../ui';
import { ACCOMMODATION_ICONS, DIETARY_ICONS } from '../accommodationIcons';
import { AdminHeaderActions } from './AdminNav';

// Inscrits › « Participants » (#262): one row per attendee of the non-cancelled parties, read-only.
// The rows are the export's (attendeeRows), so the two can't drift. Values from a fixed list are
// pills with their icon; the free-text answers open in a pop-up, from a « Détails » button only on
// rows that have some. No scroll box of its own: the page scrolls (a nested one traps a phone's
// swipe). From lg the rows are one grid whose columns size to their content (subgrid), so names
// wrap and nothing overlaps; below, each row is a card.
const SORT_KEYS = [
  { value: 'group', label: fr.participantsSortGroup },
  { value: 'name', label: fr.participantsSortName }
];
const SORT_DIRECTIONS = [
  { value: 'asc', label: fr.participantsSortAsc, icon: ArrowUp },
  { value: 'desc', label: fr.participantsSortDesc, icon: ArrowDown }
];

const COLUMNS = { flat: 'lg:grid-cols-[repeat(8,auto)]', grouped: 'lg:grid-cols-[repeat(7,auto)]' };
const ROW = 'lg:col-span-full lg:grid lg:grid-cols-subgrid lg:items-center lg:gap-x-5';

const SortHeader = ({ label, active, dir, onSort }) => (
  <span role="columnheader" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
    <button
      type="button"
      onClick={onSort}
      className="inline-flex min-h-9 items-center gap-1.5 text-left font-semibold hover:text-ink"
    >
      {label}
      {active ? (dir === 'asc' ? <ArrowUp aria-hidden="true" className="size-4 text-neon" /> : <ArrowDown aria-hidden="true" className="size-4 text-neon" />)
        : <ArrowUpDown aria-hidden="true" className="size-4 opacity-60" />}
    </button>
  </span>
);

const Header = ({ children }) => <span role="columnheader">{children}</span>;

const DietPills = ({ row }) => row.dietaryValues.map((value, index) => (
  <Tag key={value} icon={DIETARY_ICONS[value]}>{row.dietary[index]}</Tag>
));

const SleepingPill = ({ row }) => row.sleeping && <Tag icon={ACCOMMODATION_ICONS[row.sleepingValue]}>{row.sleeping}</Tag>;

const ParticipantRow = ({ row, grouped, onDetails }) => {
  const hasDetails = !!(row.dietaryOther || row.sleepingOther);
  return (
    <div role="row" className={cx('flex flex-col gap-2 border-b border-line px-4 py-3 last:border-b-0 lg:px-5', ROW)}>
      <div role="cell" className="flex min-w-0 items-start justify-between gap-3 lg:contents">
        <span data-participant-name className="min-w-0 break-words font-semibold text-ink lg:py-1">{row.name || fr.notSpecified}</span>
        {hasDetails && (
          <button
            type="button"
            onClick={() => onDetails(row)}
            aria-label={`${fr.participantsDetails}: ${row.name}`}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-line px-3 text-sm font-semibold text-muted hover:border-edge hover:text-ink lg:order-last"
          >
            <Info aria-hidden="true" className="size-4" />
            {fr.participantsDetails}
          </button>
        )}
      </div>
      {grouped
        ? null
        : <span role="cell" className="min-w-0 break-words text-sm text-faint lg:text-base lg:text-muted">{row.contact}</span>}
      <div className="flex flex-wrap items-center gap-1.5 lg:contents">
        <span role="cell"><Tag>{row.type}</Tag></span>
        <span role="cell">{row.participation && <Tag>{row.participation}</Tag>}</span>
        <span role="cell" className="contents lg:flex lg:flex-wrap lg:gap-1.5"><DietPills row={row} /></span>
        <span role="cell" className="contents lg:block"><SleepingPill row={row} /></span>
        <span role="cell" className="contents lg:flex lg:flex-wrap lg:gap-1.5">
          <Tag tone={row.waitlisted ? 'warn' : 'ok'}>{row.status}</Tag>
          {row.firstTime && <Tag tone="neon">{fr.firstTimeTag}</Tag>}
        </span>
      </div>
    </div>
  );
};

const Section = ({ icon: Icon, title, children }) => (
  <section>
    <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-faint">
      <Icon aria-hidden="true" className="size-4" />{title}
    </h3>
    <div className="mt-3 space-y-3">{children}</div>
  </section>
);

const Field = ({ label, children }) => (
  <div>
    <dt className="text-sm text-muted">{label}</dt>
    <dd className="mt-1 whitespace-pre-wrap break-words text-base text-ink">{children}</dd>
  </div>
);

const DetailsDialog = ({ row, onClose }) => (
  <Dialog open={!!row} onClose={onClose} title={row ? fr.participantsDetailsTitle.replace('{name}', row.name || fr.notSpecified) : ''} size="sm">
    {row && (
      <div className="space-y-6 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-6">
        <p className="text-sm text-muted">{fr.participantsGroupOf.replace('{name}', row.contact)}</p>
        {row.dietaryOther && (
          <Section icon={Utensils} title={fr.participantsDietSection}>
            <div className="flex flex-wrap gap-1.5"><DietPills row={row} /></div>
            <dl><Field label={fr.exportDietaryOther}>{row.dietaryOther}</Field></dl>
          </Section>
        )}
        {row.sleepingOther && (
          <Section icon={ACCOMMODATION_ICONS[row.sleepingValue] || ACCOMMODATION_ICONS.bed} title={fr.participantsSleepingSection}>
            <div className="flex flex-wrap gap-1.5"><SleepingPill row={row} /></div>
            <dl><Field label={fr.participantsSleepingOther}>{row.sleepingOther}</Field></dl>
          </Section>
        )}
      </div>
    )}
  </Dialog>
);

const SortDialog = ({ open, sort, onChange, onClose }) => (
  <Dialog open={open} onClose={onClose} title={fr.participantsSortLabel} size="sm">
    <div className="space-y-5 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-6">
      <ChipGroup label={fr.participantsSortLabel} options={SORT_KEYS} value={sort.key} onChange={key => onChange({ ...sort, key })} />
      <ChipGroup label={fr.participantsSortDirection} options={SORT_DIRECTIONS} value={sort.dir} onChange={dir => onChange({ ...sort, dir })} />
    </div>
  </Dialog>
);

const ParticipantsView = ({ parties }) => {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: 'group', dir: 'asc' });
  const [grouped, setGrouped] = useState(false);
  const [details, setDetails] = useState(null);
  const [sortOpen, setSortOpen] = useState(false);

  const rows = useMemo(() => attendeeRows(parties), [parties]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = needle ? rows.filter(row => [row.name, row.contact].some(v => v.toLowerCase().includes(needle))) : rows;
    return sortAttendees(matching, { ...sort, grouped });
  }, [rows, query, sort, grouped]);

  const sortBy = key => setSort(current => ({ key, dir: current.key === key && current.dir === 'asc' ? 'desc' : 'asc' }));

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

      <div className="flex items-center gap-3">
        <span className="text-sm text-faint">{plural(visible.length, 'countPersonOne', 'countPersonOther')}</span>
        {/* Phones sort from here; desktop sorts from the column headers (the name's only once grouped, so this stays for the group order). */}
        <Button variant="secondary" size="sm" onClick={() => setSortOpen(true)} aria-haspopup="dialog" className={cx('ml-auto', !grouped && 'lg:hidden')}>
          <ArrowUpDown aria-hidden="true" className="size-4" />{fr.participantsSortButton}
        </Button>
        <Toggle checked={grouped} onChange={setGrouped} label={fr.participantsGroupBy} className={cx('gap-3', grouped || 'lg:ml-auto')} />
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={UsersRound} title={rows.length ? fr.participantsNone : fr.participantsEmpty} />
      ) : (
        <div role="table" aria-label={fr.participantsListLabel} className="overflow-hidden rounded-card border border-line bg-surface">
          <div className={cx('lg:grid', grouped ? COLUMNS.grouped : COLUMNS.flat)}>
            <div role="row" className={cx('hidden border-b border-line px-5 py-2 text-sm text-faint', ROW)}>
              <SortHeader label={fr.exportAttendeeName} active={sort.key === 'name'} dir={sort.dir} onSort={() => sortBy('name')} />
              {!grouped && <SortHeader label={fr.participantsColumnGroup} active={sort.key === 'group'} dir={sort.dir} onSort={() => sortBy('group')} />}
              <Header>{fr.exportAttendeeType}</Header>
              <Header>{fr.exportParticipation}</Header>
              <Header>{fr.exportDietaryNeeds}</Header>
              <Header>{fr.exportSleepingPref}</Header>
              <Header>{fr.exportStatus}</Header>
              <span aria-hidden="true" />
            </div>
            {visible.map((row, index) => (
              <Fragment key={row.key}>
                {grouped && visible[index - 1]?.partyId !== row.partyId && (
                  <div role="row" className="border-b border-line bg-raised px-4 py-2 text-sm font-semibold text-muted lg:col-span-full lg:px-5">
                    <span role="cell" className="break-words">{fr.participantsGroupOf.replace('{name}', row.contact)}</span>
                  </div>
                )}
                <ParticipantRow row={row} grouped={grouped} onDetails={setDetails} />
              </Fragment>
            ))}
          </div>
        </div>
      )}

      <DetailsDialog row={details} onClose={() => setDetails(null)} />
      <SortDialog open={sortOpen} sort={sort} onChange={setSort} onClose={() => setSortOpen(false)} />
    </section>
  );
};

export default ParticipantsView;
