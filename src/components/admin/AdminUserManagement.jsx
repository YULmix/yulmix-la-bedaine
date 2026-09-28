import { useMemo, useState } from 'react';
import { Pencil, Search, UsersRound } from 'lucide-react';
import fr from '../../locales/fr.json';
import {
  PAYMENT_STATUS,
  getPaymentStatusShortLabel,
  getRegistrationStatusLabel,
  isActiveRegistration
} from '../../lib/registrationOptions';
import { formatCurrency } from '../../lib/format';
import { initials, plural } from '../../lib/eventDisplay';
import { Button, EmptyState, Input, Tag, cx, tagToneClass } from '../ui';

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

// Name | email | people | amount | payment | admin | edit, from lg up; a card per party below.
const GRID_COLUMNS = 'lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_5rem_7rem_7rem_4.5rem_3rem]';

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

// Registered parties: who they are, what they owe, whether they paid. Payment and admin changes
// go through the parent, which confirms before writing.
const AdminUserManagement = ({
  parties,
  currentUserId,
  getRoundedPartyTotal,
  onOpenUserProfile,
  onAdminToggle,
  onPaymentToggle,
  onEditParty
}) => {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

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

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <h2 className="text-xl font-semibold text-ink">{fr.adminUsersManagementTitle}</h2>
        <div className="relative md:w-80">
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
      </div>

      <FilterPills filters={FILTERS} value={filter} onChange={setFilter} counts={counts} label={fr.filterLabel} />

      {visible.length === 0 ? (
        <EmptyState icon={UsersRound} title={parties.length ? fr.noMatchingParties : fr.noPartiesYet} />
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <div className={`hidden lg:grid ${GRID_COLUMNS} lg:gap-4 border-b border-line px-5 py-3 text-sm font-semibold text-faint`}>
            <span>{fr.logisticsTableName}</span>
            <span>{fr.logisticsTableEmail}</span>
            <span>{fr.peopleColumn}</span>
            <span className="text-right">{fr.amountDue}</span>
            <span>{fr.paymentColumn}</span>
            <span>{fr.adminTableHeader}</span>
            <span className="sr-only">{fr.actionsTableHeader}</span>
          </div>
          <ul className="divide-y divide-line">
            {visible.map(party => {
              const profile = party.profiles || {};
              const isSelf = profile.id === currentUserId;
              const isPaid = party.payment_status === PAYMENT_STATUS.PAID;
              const isCancelled = !isActiveRegistration(party);
              const amount = isCancelled ? 0 : getRoundedPartyTotal(party);
              const people = (party.attendees || []).length;
              return (
                <li
                  key={party.id}
                  className={`grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-3 px-4 py-4 ${GRID_COLUMNS} lg:gap-4 lg:px-5 lg:py-3`}
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
                    ) : (
                      <button
                        onClick={() => onPaymentToggle(party, isPaid ? PAYMENT_STATUS.UNPAID : PAYMENT_STATUS.PAID)}
                        title={isPaid ? fr.markUnpaid : fr.markPaid}
                        className={cx('inline-flex min-h-9 items-center justify-self-start rounded-full px-3 text-sm font-semibold transition hover:brightness-125', tagToneClass(isPaid ? 'ok' : 'warn'))}
                      >
                        {getPaymentStatusShortLabel(party.payment_status)}
                      </button>
                    )}
                    <label className={cx('ml-auto inline-flex min-h-9 items-center gap-2 text-sm text-muted lg:ml-0', isSelf ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}>
                      <input
                        type="checkbox"
                        checked={!!profile.is_admin}
                        onChange={e => onAdminToggle(profile, e.target.checked)}
                        disabled={isSelf}
                        aria-label={fr.adminTableHeader}
                        className="size-5 accent-[var(--color-neon)]"
                      />
                      <span className="lg:sr-only">{fr.adminTableHeader}</span>
                    </label>
                    <Button
                      variant="secondary"
                      size="icon"
                      onClick={() => onEditParty(party)}
                      aria-label={fr.editRegistrationButton}
                      title={fr.editRegistrationButton}
                    >
                      <Pencil aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
                    </Button>
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
