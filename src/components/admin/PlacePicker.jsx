import { useId, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import fr from '../../locales/fr.json';
import { ACCOMMODATION_OPTIONS, getOptionLabel } from '../../lib/registrationOptions';
import { searchPlaceOptions } from '../../lib/places';
import { Input, cx } from '../ui';

const UNASSIGN = 'unassign';

export const placeName = place => `${place.locationName} · ${place.label}`;

// A searchable place dropdown (#114): the ARIA 1.2 combobox pattern, an input that filters a
// listbox, with arrow keys, Enter and Escape. `options` come ordered from placeOptions(); full
// places stay pickable, marked "complet". `value` is a place id or null; onChange gets the same.
const PlacePicker = ({ id, label, options, value, onChange, disabled, describedBy }) => {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const selected = options.find(option => option.place.id === value)?.place;
  const items = useMemo(() => {
    const found = searchPlaceOptions(options, query).map(option => ({ key: option.place.id, option }));
    return value && !query ? [{ key: UNASSIGN }, ...found] : found;
  }, [options, query, value]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const choose = (item) => {
    onChange(item.key === UNASSIGN ? null : item.key);
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
        id={id}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && items[active] ? optionId(active) : undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        disabled={disabled}
        placeholder={disabled ? '' : fr.placePickerPlaceholder}
        value={open ? query : (selected ? placeName(selected) : '')}
        onChange={(event) => {
          setQuery(event.target.value);
          openAt(0);
        }}
        onFocus={() => openAt(0)}
        onClick={() => !open && openAt(0)}
        onBlur={close}
        onKeyDown={onKeyDown}
        // A dropdown until it has focus (the list open, typing filters): only then a text cursor.
        className="cursor-pointer pr-9 font-data focus:cursor-text disabled:cursor-not-allowed disabled:opacity-60"
      />
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />

      <ul
        id={listId}
        role="listbox"
        aria-label={label}
        hidden={!open}
        // Keeps focus in the input, so a click chooses before the blur closes the list.
        onMouseDown={event => event.preventDefault()}
        className="absolute z-20 mt-1 max-h-72 w-full min-w-64 overflow-y-auto rounded-control border border-edge bg-surface p-1 shadow-lg"
      >
        {items.length === 0 && <li className="px-3 py-2 text-sm text-faint">{fr.placePickerNoMatch}</li>}
        {items.map((item, index) => {
          const { option } = item;
          return (
            <li
              key={item.key}
              id={optionId(index)}
              role="option"
              aria-selected={item.key === (value ?? UNASSIGN)}
              onClick={() => choose(item)}
              onMouseEnter={() => setActive(index)}
              className={cx('cursor-pointer rounded-control px-3 py-2', index === active && 'bg-night')}
            >
              {option ? (
                <>
                  <span className="block font-semibold text-ink">{placeName(option.place)}</span>
                  <span className="block text-sm text-muted">
                    {getOptionLabel(ACCOMMODATION_OPTIONS, option.place.type)}
                    {' · '}
                    {option.full
                      ? <span className="font-semibold text-warn">{fr.placePickerFull}</span>
                      : fr.placePickerRemaining.replace('{remaining}', option.remaining).replace('{capacity}', option.place.capacity)}
                  </span>
                </>
              ) : (
                <span className="text-muted">{fr.placePickerUnassign}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default PlacePicker;
