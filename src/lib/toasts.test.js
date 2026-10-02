import { createToastStore, DEFAULT_TOAST_DURATION_MS } from './toasts';

test('notify adds a toast and removes it after its duration; dismiss removes it at once', () => {
  const timers = [];
  const store = createToastStore((run, ms) => timers.push({ run, ms }));
  const listener = jest.fn();
  store.subscribe(listener);

  const first = store.notify('Enregistré', 'success');
  const second = store.notify('Erreur', 'error', 1000);
  expect(store.getToasts()).toEqual([
    { id: first, message: 'Enregistré', type: 'success' },
    { id: second, message: 'Erreur', type: 'error' }
  ]);
  expect(timers.map(timer => timer.ms)).toEqual([DEFAULT_TOAST_DURATION_MS, 1000]);
  expect(first).not.toBe(second);

  store.dismiss(first);
  expect(store.getToasts().map(toast => toast.id)).toEqual([second]);
  timers[1].run();
  expect(store.getToasts()).toEqual([]);
  // A timer for a toast already dismissed changes nothing.
  const calls = listener.mock.calls.length;
  timers[0].run();
  expect(listener.mock.calls.length).toBe(calls);
});

test('the default type is info', () => {
  const store = createToastStore(() => {});
  store.notify('Note');
  expect(store.getToasts()[0].type).toBe('info');
});
