import { useMemo, useRef, useState } from 'react';
import { Pencil, Search, UsersRound } from 'lucide-react';
import fr from '../../locales/fr.json';
import {
  PAYMENT_STATUS,
  getPaymentStatusShortLabel,
  getRegistrationStatusLabel,
  isActiveRegistration
} from '../../lib/registrationOptions';
import { formatCurrency } from '../../lib/format';
import { amountOwedOf } from '../../lib/adminStats';
import { initials, plural } from '../../lib/eventDisplay';
import { Button, EmptyState, Input, Tag, cx, tagToneClass } from '../ui';
import { useFitToViewport } from '../../hooks/useFitToViewport';
import { AdminHeaderActions } from './AdminNav';

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

// Name | email | people | amount | payment | edit, from lg up; a card per party below.
// Without the editor (anyone but an admin, #217), the last column goes.
const GRID_COLUMNS = 'lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_5rem_7rem_7rem_3rem]';
const READ_GRID_COLUMNS = 'lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_5rem_7rem_7rem]';

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

// Registered parties: who they are, what they owe, whether they paid. Payment changes
// go through the parent, which confirms before writing. The search is in the page header; the
// list scrolls in a box that ends on screen (a dense page, ADR 0022). An action whose handler is
// missing isn't rendered: the role doesn't allow it (#217); the payment shows as a tag instead.
const AdminUserManagement = ({
  parties,
  onOpenUserProfile,
  onPaymentToggle,
  onEditParty
}) => {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const listRef = useRef(null);
  const showAdminColumns = !!onEditParty;
  const gridColumns = showAdminColumns ? GRID_COLUMNS : READ_GRID_COLUMNS;

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map(f => [f.id, parties.filter(f.test).length])),
    [parties]
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    // Falls back to "Tous" if the selected pill disappeared (its last party was re-registered).
    const activeFilter = FILTERS.find(f => f.id === filter && isShown(f, counts)) || FILTERS[0];
    return parties.filter(party => {
      if (!activeFilter.test(party)) return false;
      if (!needle) return true;
      const profile = party.profiles || {};
      return [profile.full_name, profile.email, ...(party.attendees || []).map(a => a.name)]
        .some(value => value?.toLowerCase().includes(needle));
    });
  }, [parties, query, filter, counts]);
  useFitToViewport(listRef, { deps: [visible] });

  return (
    <section className="space-y-4">
      <AdminHeaderActions>
        <div className="relative w-full sm:w-72">
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

      {visible.length === 0 ? (
        <EmptyState icon={UsersRound} title={parties.length ? fr.noMatchingParties : fr.noPartiesYet} />
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <div className={`hidden lg:grid ${gridColumns} lg:gap-4 border-b border-line px-5 py-3 text-sm font-semibold text-faint`}>
            <span>{fr.logisticsTableName}</span>
            <span>{fr.logisticsTableEmail}</span>
            <span>{fr.peopleColumn}</span>
            <span className="text-right">{fr.amountDue}</span>
            <span>{fr.paymentColumn}</span>
            {showAdminColumns && <span className="sr-only">{fr.actionsTableHeader}</span>}
          </div>
          {/* relative: the rows' visually hidden inputs are absolutely positioned, and would otherwise escape the scroll box and stretch the page. */}
          <ul ref={listRef} className="relative divide-y divide-line overflow-y-auto overscroll-contain">
            {visible.map(party => {
              const profile = party.profiles || {};
              const isPaid = party.payment_status === PAYMENT_STATUS.PAID;
              const isCancelled = !isActiveRegistration(party);
              const amount = isCancelled ? 0 : amountOwedOf(party);
              const people = (party.attendees || []).length;
              return (
                <li
                  key={party.id}
                  className={`grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-3 px-4 py-4 ${gridColumns} lg:gap-4 lg:px-5 lg:py-3`}
                >
                  <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-raised font-data text-sm text-muted lg:hidden">
                    {initials(profile.full_name || profile.email)}
                  </span>
                  <div className="min-w-0">
                    <button
                      onClick={() => onOpenUserProfile(profile)}
                      className="max-w-full truncate text-left font-semibold text-ink underline decoration-edge underline-offset-4 hover:decoration-neon"
                    >
                      {profile.full_name || fr.notSpecified}
                    </button>
                    <p className="truncate text-sm text-faint lg:hidden">
                      {plural(people, 'countPersonOne', 'countPersonOther')}{party.is_waitlisted ? `, ${fr.filterWaitlist.toLowerCase()}` : ''}
                    </p>
                  </div>
                  <span className="font-data text-base text-ink lg:hidden">{formatCurrency(amount)}</span>

                  <span className="col-span-3 hidden truncate text-sm text-muted lg:col-span-1 lg:block">{profile.email}</span>
                  <span className="hidden font-data text-sm text-muted lg:block">{people}</span>
                  <span className="hidden text-right font-data text-ink lg:block">{formatCurrency(amount)}</span>

                  <div className="col-span-3 flex items-center gap-3 lg:contents">
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
                    {onEditParty && (
                      <Button
                        variant="secondary"
                        size="icon"
                        onClick={() => onEditParty(party)}
                        aria-label={fr.editRegistrationButton}
                        title={fr.editRegistrationButton}
                      >
                        <Pencil aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
};

export default AdminUserManagement;
