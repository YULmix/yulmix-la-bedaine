import { Fragment, useMemo, useState } from 'react';
import { Info, Search, UsersRound, Utensils } from 'lucide-react';
import fr from '../../locales/fr.json';
import { attendeeRows, sortAttendees } from '../../lib/dataExport';
import { ofName, plural } from '../../lib/eventDisplay';
import { Dialog, EmptyState, Tag, Toggle, cx } from '../ui';
import { ACCOMMODATION_ICONS, DIETARY_ICONS } from '../accommodationIcons';
import { AdminHeaderActions } from './AdminNav';
import { SortButton, SortDialog, SortSheetButton, ariaSort } from './SortControls';

// Inscrits › « Participants » (#262): one row per attendee of the non-cancelled parties, read-only.
// The rows are the export's (attendeeRows), so the two can't drift. Values from a fixed list are
// pills with their icon; the free-text answers open in a pop-up, from a « Détails » button only on
// rows that have some. No scroll box of its own: the page scrolls (a nested one traps a phone's
// swipe). From xl the rows are one grid whose columns size to their content (subgrid), so names
// wrap and nothing overlaps; below, each row is a card.
const SORT_KEYS = [
  { value: 'group', label: fr.participantsSortGroup },
  { value: 'name', label: fr.participantsSortName }
];

// From xl the rows share one grid (subgrid; the gap is the grid's, a subgrid's own would pad every
// cell). Pills never wrap and a cell with several (diet, status) stacks them, so each of those
// columns is as wide as its longest pill. The first column, the name with the group under it, is
// the one that gives: at least 11rem, up to its longest line; any width left spreads the pills.
const COLUMNS = 'xl:grid xl:grid-cols-[minmax(11rem,max-content)_repeat(6,auto)] xl:gap-x-4';
const ROW = 'xl:col-span-full xl:grid xl:grid-cols-subgrid xl:items-center xl:[column-gap:normal]';
// A cell holding several pills: inline with the card's other pills below xl, stacked in the table.
const STACK = 'contents xl:flex xl:flex-col xl:items-start xl:gap-1.5';

const Header = ({ children, className }) => <span role="columnheader" className={cx('whitespace-nowrap', className)}>{children}</span>;

const DietPills = ({ row }) => row.dietaryValues.map((value, index) => (
  <Tag key={value} icon={DIETARY_ICONS[value]}>{row.dietary[index]}</Tag>
));

const SleepingPill = ({ row }) => row.sleeping && <Tag icon={ACCOMMODATION_ICONS[row.sleepingValue]}>{row.sleeping}</Tag>;

const groupOf = row => fr.participantsGroupOf.replace('{ofName}', ofName(row.contact));

const GroupLine = ({ row, className }) => (
  <span className={cx('flex min-w-0 items-start gap-1.5 text-sm text-faint', className)}>
    <UsersRound aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
    <span className="min-w-0 break-words">{groupOf(row)}</span>
  </span>
);

// Below xl a card: the name, its group under it and « Détails » on top, then the pills on as many
// lines as they need. From xl the same cells are the table's columns (the pills' wrapper becomes
// display: contents) and « Détails » is an icon at the end of the row.
const ParticipantRow = ({ row, grouped, onDetails }) => {
  const hasDetails = !!(row.dietaryOther || row.sleepingOther);
  return (
    <div role="row" className={cx('grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2.5 border-b border-line px-4 py-3 last:border-b-0 xl:px-5 xl:py-2.5', ROW)}>
      <span role="cell" className="flex min-w-0 flex-col gap-0.5 self-center">
        <span data-participant-name className="break-words font-semibold text-ink">{row.name || fr.notSpecified}</span>
        {grouped || <GroupLine row={row} />}
      </span>
      <div className="col-span-full flex flex-wrap items-center gap-1.5 xl:contents">
        <span role="cell" className="contents xl:block"><Tag>{row.type}</Tag></span>
        <span role="cell" className="contents xl:block">{row.participation && <Tag>{row.participation}</Tag>}</span>
        <span role="cell" className={STACK}><DietPills row={row} /></span>
        <span role="cell" className="contents xl:block"><SleepingPill row={row} /></span>
        <span role="cell" className={STACK}>
          <Tag tone={row.waitlisted ? 'warn' : 'ok'}>{row.status}</Tag>
          {row.firstTime && <Tag tone="neon">{fr.firstTimeTag}</Tag>}
        </span>
      </div>
      {hasDetails && (
        <span role="cell" className="col-start-2 row-start-1 xl:col-start-auto xl:row-start-auto">
          <button
            type="button"
            onClick={() => onDetails(row)}
            aria-label={`${fr.participantsDetails}: ${row.name}`}
            title={fr.participantsDetails}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line px-3 text-sm font-semibold text-muted hover:border-edge hover:text-ink xl:size-9 xl:justify-center xl:px-0"
          >
            <Info aria-hidden="true" className="size-4" />
            <span className="xl:sr-only">{fr.participantsDetails}</span>
          </button>
        </span>
      )}
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
  <Dialog open={!!row} onClose={onClose} title={row ? fr.participantsDetailsTitle.replace('{ofName}', ofName(row.name || fr.notSpecified)) : ''} size="sm">
    {row && (
      <div className="space-y-6 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-6">
        <GroupLine row={row} className="text-muted" />
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
        <SortSheetButton onClick={() => setSortOpen(true)} className={cx('ml-auto', !grouped && 'xl:hidden')} />
        <Toggle checked={grouped} onChange={setGrouped} label={fr.participantsGroupBy} className={cx('gap-3', grouped || 'xl:ml-auto')} />
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={UsersRound} title={rows.length ? fr.participantsNone : fr.participantsEmpty} />
      ) : (
        <div role="table" aria-label={fr.participantsListLabel} className="overflow-hidden rounded-card border border-line bg-surface">
          <div className={COLUMNS}>
            <div role="row" className={cx('hidden border-b border-line px-5 py-2 text-sm text-faint', ROW)}>
              {/* The first column sorts by name, or (flat) by group: the group is the line under each name. */}
              <span role="columnheader" aria-sort={ariaSort(sort.key === 'name' || !grouped, sort.dir)} className="flex items-center gap-4">
                <SortButton label={fr.exportAttendeeName} active={sort.key === 'name'} dir={sort.dir} onSort={() => sortBy('name')} />
                {grouped || <SortButton label={fr.participantsColumnGroup} active={sort.key === 'group'} dir={sort.dir} onSort={() => sortBy('group')} />}
              </span>
              <Header>{fr.exportAttendeeType}</Header>
              <Header>{fr.exportParticipation}</Header>
              <Header>{fr.participantsDietSection}</Header>
              <Header>{fr.participantsSleepingSection}</Header>
              <Header>{fr.exportStatus}</Header>
              <Header className="sr-only">{fr.participantsDetails}</Header>
            </div>
            {visible.map((row, index) => (
              <Fragment key={row.key}>
                {grouped && visible[index - 1]?.partyId !== row.partyId && (
                  <div role="row" className="border-b border-line bg-raised px-4 py-2 text-sm font-semibold text-muted xl:col-span-full xl:px-5">
                    <span role="cell" className="flex min-w-0 items-start gap-1.5">
                      <UsersRound aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                      <span className="min-w-0 break-words">{groupOf(row)}</span>
                    </span>
                  </div>
                )}
                <ParticipantRow row={row} grouped={grouped} onDetails={setDetails} />
              </Fragment>
            ))}
          </div>
        </div>
      )}

      <DetailsDialog row={details} onClose={() => setDetails(null)} />
      <SortDialog open={sortOpen} keys={SORT_KEYS} sort={sort} onChange={setSort} onClose={() => setSortOpen(false)} />
    </section>
  );
};

export default ParticipantsView;
