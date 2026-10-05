import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import fr from '../../locales/fr.json';
import { Button, ChipGroup, Dialog, cx } from '../ui';

// The admin tables' sort (#262, reused by the Inscrits « Liste », #259). Desktop sorts from the
// column headers: a SortButton inside each sortable columnheader, which carries aria-sort. Smaller
// widths have no headers: a « Trier » button (SortSheetButton) opens a sheet (SortDialog) with the
// key and the direction. A sort is { key, dir }, dir 'asc' | 'desc'.

const DIRECTIONS = [
  { value: 'asc', label: fr.participantsSortAsc, icon: ArrowUp },
  { value: 'desc', label: fr.participantsSortDesc, icon: ArrowDown }
];

/** The aria-sort value of a column whose key is `active` or not. */
export const ariaSort = (active, dir) => (active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none');

export const SortButton = ({ label, active, dir, onSort }) => (
  <button
    type="button"
    onClick={onSort}
    aria-pressed={active}
    className={cx('inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap text-left font-semibold hover:text-ink', active && 'text-ink')}
  >
    {label}
    {active ? (dir === 'asc' ? <ArrowUp aria-hidden="true" className="size-4 text-neon" /> : <ArrowDown aria-hidden="true" className="size-4 text-neon" />)
      : <ArrowUpDown aria-hidden="true" className="size-4 opacity-60" />}
  </button>
);

export const SortSheetButton = ({ onClick, className }) => (
  <Button variant="secondary" size="sm" onClick={onClick} aria-haspopup="dialog" className={className}>
    <ArrowUpDown aria-hidden="true" className="size-4" />{fr.participantsSortButton}
  </Button>
);

/** `keys`: the ChipGroup options ({ value, label }) of the sortable keys. */
export const SortDialog = ({ open, keys, sort, onChange, onClose }) => (
  <Dialog open={open} onClose={onClose} title={fr.participantsSortButton} size="sm">
    <div className="space-y-5 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-6">
      <ChipGroup label={fr.participantsSortLabel} options={keys} value={sort.key} onChange={key => onChange({ ...sort, key })} />
      <ChipGroup label={fr.participantsSortDirection} options={DIRECTIONS} value={sort.dir} onChange={dir => onChange({ ...sort, dir })} />
    </div>
  </Dialog>
);
