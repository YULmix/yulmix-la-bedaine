import { useCallback, useState } from 'react';

// A boolean remembered on this device (local storage), `fallback` on a first visit. Unreadable or
// unwritable storage (private mode, blocked) isn't an error: the toggle works for the page's life
// and starts from `fallback` next time. Returns [value, toggle].
export const useRememberedToggle = (storageKey, fallback = false) => {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      return stored === null ? fallback : stored === '1';
    } catch {
      return fallback;
    }
  });
  const toggle = useCallback(() => {
    setValue(current => {
      const next = !current;
      try {
        window.localStorage.setItem(storageKey, next ? '1' : '0');
      } catch {
        // Not remembered; the state above still changes.
      }
      return next;
    });
  }, [storageKey]);
  return [value, toggle];
};
