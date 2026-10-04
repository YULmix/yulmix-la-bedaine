import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import fr from '../locales/fr.json';
import { initials } from '../lib/eventDisplay';
import { ACCOUNT_LEVEL_FILTER_OPTIONS, getAccountLevelLabel } from '../lib/registrationOptions';
import { ChipGroup, Input, Tag, cx } from './ui';

// Every level's tag tone, the header ring's (#260).
const LEVEL_TONES = { admin: 'neon', organiser: 'info', committee: 'ok', member: 'neutral' };

// Shared by the Preview « Se connecter comme… » dialog (#105) and « Voir comme » (#106): the same
// list, search, level filter and selection; only what choosing does differs (`onChoose`).
//   accounts:     { id, email, full_name, level } where level is accountLevel()'s;
//   onChoose:     called with the account;
//   isDisabled:   optional, rows that can't be chosen (Voir comme: admins);
//   isCurrent:    optional, the signed-in account: tagged « Compte actuel » and not choosable;
//   renderTags:   optional, extra tags after the level's (Preview: registration state);
//   header:       optional, above the search (Preview: quick buttons, email field).
const AccountPicker = ({ accounts, onChoose, isDisabled, isCurrent, renderTags, header, loading = false, error = false }) => {
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('all');

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return accounts.filter(account => (level === 'all' || account.level === level)
      && (!needle || [account.full_name, account.email].some(v => v?.toLowerCase().includes(needle))));
  }, [accounts, query, level]);

  return (
    <div className="space-y-3">
      {header}
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4.5 -translate-y-1/2 text-faint" />
        <Input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={fr.accountSearch} aria-label={fr.accountSearch} className="pl-10" />
      </div>
      <ChipGroup size="sm" label={fr.accountLevelFilterLabel} options={ACCOUNT_LEVEL_FILTER_OPTIONS} value={level} onChange={setLevel} />
      {loading && <p className="text-sm text-faint">{fr.accountsLoading}</p>}
      {error && <p className="text-sm text-bad">{fr.accountsLoadError}</p>}
      {!loading && !error && visible.length === 0 && <p className="text-sm text-faint">{fr.accountsNoMatch}</p>}
      {visible.length > 0 && (
        <ul className="divide-y divide-line rounded-card border border-line">
          {visible.map(account => {
            const current = !!isCurrent?.(account);
            const disabled = current || !!isDisabled?.(account);
            return (
              <li key={account.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChoose(account)}
                  className={cx(
                    'flex w-full min-h-11 items-start gap-3 px-4 py-3 text-left transition duration-150',
                    current ? 'cursor-default bg-raised' : 'hover:bg-raised disabled:opacity-60'
                  )}
                >
                  <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-raised font-data text-sm text-muted">
                    {initials(account.full_name || account.email)}
                  </span>
                  <span className="min-w-0 flex-1 space-y-1.5">
                    <span className="block truncate font-semibold text-ink">
                      {account.full_name || fr.notSpecified}
                      {current && <span className="ml-2 text-sm font-normal text-faint">{fr.accountCurrent}</span>}
                    </span>
                    <span className="block truncate font-data text-xs text-faint">{account.email}</span>
                    <span className="flex flex-wrap gap-1.5">
                      <Tag tone={LEVEL_TONES[account.level]}>{getAccountLevelLabel(account.level)}</Tag>
                      {renderTags?.(account)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default AccountPicker;
