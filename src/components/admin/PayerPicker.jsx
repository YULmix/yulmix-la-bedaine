import { useId, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import fr from '../../locales/fr.json';
import { payerText, searchPayerOptions } from '../../lib/budgetPayers';
import { Input, cx } from '../ui';

const NONE = 'none';

// « Payé par » (#236): a searchable attendee dropdown, the ARIA 1.2 combobox pattern as the place
// picker (an input that filters a listbox; arrow keys, Enter, Escape). The list is as wide as the
// input, so on a phone it is a full-width list. `value` is an attendee id or null; `selected` is
// what to show for it ({ name, removed }), since a removed attendee isn't among `options`.
const PayerPicker = ({ label, options, value, selected, onChange }) => {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const items = useMemo(() => {
    const found = searchPayerOptions(options, query).map(option => ({ key: option.id, option }));
    return value && !query ? [{ key: NONE }, ...found] : found;
  }, [options, query, value]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const choose = (item) => {
    onChange(item.key === NONE ? null : item.key);
    close();
  };
  const openAt = (index) => {
    setOpen(true);
    setActive(Math.max(0, Math.min(index, items.length - 1)));
  };
  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openAt(open ? active + 1 : 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openAt(open ? active - 1 : items.length - 1);
    } else if (event.key === 'Enter' && open && items[active]) {
      event.preventDefault();
      choose(items[active]);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
    }
  };
  const optionId = index => `${listId}-${index}`;

  return (
    <div className="relative">
      <Input
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && items[active] ? optionId(active) : undefined}
        autoComplete="off"
        placeholder={fr.budgetPayerPlaceholder}
        value={open ? query : payerText(value ? selected : null)}
        onChange={(event) => {
          setQuery(event.target.value);
          openAt(0);
        }}
        onFocus={() => openAt(0)}
        onClick={() => !open && openAt(0)}
        onBlur={close}
        onKeyDown={onKeyDown}
        className="pr-9"
      />
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
      <ul
        id={listId}
        role="listbox"
        aria-label={label}
        hidden={!open}
        // Keeps focus in the input, so a click chooses before the blur closes the list.
        onMouseDown={event => event.preventDefault()}
        className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-control border border-edge bg-surface p-1 shadow-lg"
      >
        {items.length === 0 && <li className="px-3 py-2 text-sm text-faint">{fr.budgetPayerNoMatch}</li>}
        {items.map((item, index) => (
          <li
            key={item.key}
            id={optionId(index)}
            role="option"
            aria-selected={item.key === (value ?? NONE)}
            onClick={() => choose(item)}
            onMouseEnter={() => setActive(index)}
            className={cx('cursor-pointer rounded-control px-3 py-2', index === active && 'bg-night')}
          >
            {item.option ? (
              <>
                <span className="block font-semibold text-ink">{item.option.name}</span>
                {item.option.accountName && <span className="block truncate text-sm text-muted">{item.option.accountName}</span>}
              </>
            ) : (
              <span className="text-muted">{fr.budgetPayerNone}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default PayerPicker;
