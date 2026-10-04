import { useMemo, useRef, useState } from 'react';
import { Search, UsersRound } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import fr from '../../locales/fr.json';
import {
  PAYMENT_STATUS,
  getPaymentStatusShortLabel,
  getRegistrationStatusLabel,
  isActiveRegistration
} from '../../lib/registrationOptions';
import { formatCurrency, formatDate } from '../../lib/format';
import { PARTY_SORT_KEYS, parsePartySort, partySortParam, partyModifiedAt, sortParties, toggledPartySort } from '../../lib/partySort';
import { amountOwedOf } from '../../lib/adminStats';
import { initials, plural } from '../../lib/eventDisplay';
import { EmptyState, Input, Tag, cx, tagToneClass } from '../ui';
import { useFitToViewport } from '../../hooks/useFitToViewport';
import { AdminHeaderActions } from './AdminNav';
import { SortButton, SortDialog, SortSheetButton, ariaSort } from './SortControls';

// A cancelled party owes nothing and counts for nothing (no refunds, #101): every filter but
// "Annulées" leaves it out, and that pill only shows while there is one.
const FILTERS = [
  { id: 'all', labelKey: 'filterAll', test: isActiveRegistration },
  { id: 'unpaid', labelKey: 'unpaidShort', test: party => isActiveRegistration(party) && party.payment_status !== PAYMENT_STATUS.PAID },
  { id: 'paid', labelKey: 'paid', test: party => isActiveRegistration(party) && party.payment_status === PAYMENT_STATUS.PAID },
  { id: 'waitlist', labelKey: 'filterWaitlist', test: party => isActiveRegistration(party) && party.is_waitlisted },
  { id: 'cancelled', labelKey: 'filterCancelled', test: party => !isActiveRegistration(party), hideWhenEmpty: true }
];

const isShown = (filter, counts) => !filter.hideWhenEmpty || counts[filter.id] > 0;

// The table from xl, as « Participants »: at lg (1024) the seven columns leave the name and the
// email no room (#259 added the two dates); below xl each party is a card.
const GRID_COLUMNS = 'xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_4rem_6rem_7rem_8.5rem_8.5rem]';

const SORT_LABEL_KEYS = { name: 'logisticsTableName', registered: 'partyDetailRegisteredOn', modified: 'sortModifiedOn' };
const SORT_OPTIONS = PARTY_SORT_KEYS.map(key => ({ value: key, label: fr[SORT_LABEL_KEYS[key]] }));

// A sortable column header (#259), the same as « Participants »: aria-sort on the columnheader.
const SortHeader = ({ sortKey, sort, onSort }) => {
  const active = sort.key === sortKey;
  return (
    <span role="columnheader" aria-sort={ariaSort(active, sort.direction)}>
      <SortButton label={fr[SORT_LABEL_KEYS[sortKey]]} active={active} dir={sort.direction} onSort={() => onSort(sortKey)} />
    </span>
  );
};

export const FilterPills = ({ filters, value, onChange, counts, label }) => (
  <div role="group" aria-label={label} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
    {filters.filter(filter => isShown(filter, counts)).map(filter => {
      const selected = value === filter.id;
      return (
        <button
          key={filter.id}
          type="button"
          aria-pressed={selected}
          onClick={() => onChange(filter.id)}
          className={cx(
            'inline-flex min-h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold transition duration-150',
            selected ? 'border-neon tint-neon text-ink' : 'border-line text-muted hover:border-edge hover:text-ink'
          )}
        >
          {fr[filter.labelKey]}
          <span className="font-data text-xs text-faint">{counts[filter.id]}</span>
        </button>
      );
    })}
  </div>
);

// Registered parties: who they are, what they owe, whether they paid. A party's name opens its
// « Inscription » (#258); editing it is from there. Payment changes go through the
// parent, which confirms before writing. The search is in the page header; the
// list scrolls in a box that ends on screen (a dense page, ADR 0022). An action whose handler is
// missing isn't rendered: the role doesn't allow it (#217); the payment shows as a tag instead.
const AdminUserManagement = ({
  parties,
  onOpenParty,
  onPaymentToggle
}) => {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const listRef = useRef(null);
  // The sort is in the URL (?tri=), so it survives a reload and can be shared. A change replaces
  // the entry, like the other admin view state, so Back leaves the page rather than undoing a sort.
  const [searchParams, setSearchParams] = useSearchParams();
  const sort = useMemo(() => parsePartySort(searchParams.get('tri')), [searchParams]);
  const applySort = next => setSearchParams(prev => {
    const params = new URLSearchParams(prev);
    const value = partySortParam(next);
    if (value) params.set('tri', value); else params.delete('tri');
    return params;
  }, { replace: true });
  const onSort = key => applySort(toggledPartySort(sort, key));
  const [sortOpen, setSortOpen] = useState(false);

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map(f => [f.id, parties.filter(f.test).length])),
    [parties]
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    // Falls back to "Tous" if the selected pill disappeared (its last party was re-registered).
    const activeFilter = FILTERS.find(f => f.id === filter && isShown(f, counts)) || FILTERS[0];
    return sortParties(parties, sort).filter(party => {
      if (!activeFilter.test(party)) return false;
      if (!needle) return true;
      const profile = party.profiles || {};
      return [profile.full_name, profile.email, ...(party.attendees || []).map(a => a.name)]
        .some(value => value?.toLowerCase().includes(needle));
    });
  }, [parties, query, filter, counts, sort]);
  useFitToViewport(listRef, { fromWidth: 1280, deps: [visible] });

  return (
    <section className="space-y-4">
      <AdminHeaderActions>
        <div className="relative w-full sm:w-80">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4.5 -translate-y-1/2 text-faint" />
          <Input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={fr.searchPartiesPlaceholder}
            aria-label={fr.searchPartiesPlaceholder}
            className="pl-10"
          />
        </div>
      </AdminHeaderActions>

      <FilterPills filters={FILTERS} value={filter} onChange={setFilter} counts={counts} label={fr.filterLabel} />

      {/* Below xl there are no column headers: the « Trier » sheet, as in « Participants ». */}
      <div className="flex items-center gap-3 xl:hidden">
        <span className="text-sm text-faint">
          {fr[SORT_LABEL_KEYS[sort.key]]} · {sort.direction === 'asc' ? fr.participantsSortAsc : fr.participantsSortDesc}
        </span>
        <SortSheetButton onClick={() => setSortOpen(true)} className="ml-auto" />
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={UsersRound} title={parties.length ? fr.noMatchingParties : fr.noPartiesYet} />
      ) : (
        <div role="table" aria-label={fr.adminTabUsersShort} className="overflow-hidden rounded-card border border-line bg-surface">
          <div role="row" className={`hidden xl:grid ${GRID_COLUMNS} xl:items-center xl:gap-4 border-b border-line px-5 py-1 text-sm font-semibold text-faint`}>
            <SortHeader sortKey="name" sort={sort} onSort={onSort} />
            <span role="columnheader">{fr.logisticsTableEmail}</span>
            <span role="columnheader">{fr.peopleColumn}</span>
            <span role="columnheader" className="text-right">{fr.amountDue}</span>
            <span role="columnheader">{fr.paymentColumn}</span>
            <SortHeader sortKey="registered" sort={sort} onSort={onSort} />
            <SortHeader sortKey="modified" sort={sort} onSort={onSort} />
          </div>
          {/* relative: the rows' visually hidden inputs are absolutely positioned, and would otherwise escape the scroll box and stretch the page. */}
          <div role="rowgroup" ref={listRef} className="relative divide-y divide-line xl:overflow-y-auto xl:overscroll-contain">
            {visible.map(party => {
              const profile = party.profiles || {};
              const isPaid = party.payment_status === PAYMENT_STATUS.PAID;
              const isCancelled = !isActiveRegistration(party);
              const amount = isCancelled ? 0 : amountOwedOf(party);
              const people = (party.attendees || []).length;
              return (
                <div
                  role="row"
                  key={party.id}
                  className={`grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-3 px-4 py-4 ${GRID_COLUMNS} xl:gap-4 xl:px-5 xl:py-3`}
                >
                  <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-raised font-data text-sm text-muted xl:hidden">
                    {initials(profile.full_name || profile.email)}
                  </span>
                  <div role="cell" className="min-w-0">
                    <button
                      onClick={() => onOpenParty(party)}
                      className="max-w-full break-words text-left font-semibold text-ink underline decoration-edge underline-offset-4 hover:decoration-neon"
                    >
                      {profile.full_name || fr.notSpecified}
                    </button>
                    <p className="text-sm text-faint xl:hidden">
                      {plural(people, 'countPersonOne', 'countPersonOther')}{party.is_waitlisted ? `, ${fr.filterWaitlist.toLowerCase()}` : ''}
                    </p>
                    {sort.key !== 'name' && (
                      <p className="text-sm text-faint xl:hidden">
                        {fr[SORT_LABEL_KEYS[sort.key]]} {formatDate(sort.key === 'registered' ? party.created_at : partyModifiedAt(party))}
                      </p>
                    )}
                  </div>
                  <span role="cell" className="font-data text-base text-ink xl:hidden">{formatCurrency(amount)}</span>

                  <span role="cell" className="col-span-3 hidden break-all text-sm text-muted xl:col-span-1 xl:block">{profile.email}</span>
                  <span role="cell" className="hidden font-data text-sm text-muted xl:block">{people}</span>
                  <span role="cell" className="hidden text-right font-data text-ink xl:block">{formatCurrency(amount)}</span>

                  <div role="cell" className="col-span-3 flex items-center gap-3 xl:contents">
                    {isCancelled ? (
                      <Tag className="justify-self-start">{getRegistrationStatusLabel(party.status)}</Tag>
                    ) : !onPaymentToggle ? (
                      <Tag tone={isPaid ? 'ok' : 'warn'} className="justify-self-start">{getPaymentStatusShortLabel(party.payment_status)}</Tag>
                    ) : (
                      <button
                        onClick={() => onPaymentToggle(party, isPaid ? PAYMENT_STATUS.UNPAID : PAYMENT_STATUS.PAID)}
                        title={isPaid ? fr.markUnpaid : fr.markPaid}
                        className={cx('inline-flex min-h-9 items-center justify-self-start rounded-full px-3 text-sm font-semibold transition hover:brightness-125', tagToneClass(isPaid ? 'ok' : 'warn'))}
                      >
                        {getPaymentStatusShortLabel(party.payment_status)}
                      </button>
                    )}
                  </div>
                  <span role="cell" className="hidden text-sm text-muted xl:block">{formatDate(party.created_at)}</span>
                  <span role="cell" className="hidden text-sm text-muted xl:block">{party.last_edited_at ? formatDate(party.last_edited_at) : <span aria-label={fr.neverEditedMessage}>—</span>}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <SortDialog
        open={sortOpen}
        keys={SORT_OPTIONS}
        sort={{ key: sort.key, dir: sort.direction }}
        onChange={next => applySort({ key: next.key, direction: next.dir })}
        onClose={() => setSortOpen(false)}
      />
    </section>
  );
};

export default AdminUserManagement;
