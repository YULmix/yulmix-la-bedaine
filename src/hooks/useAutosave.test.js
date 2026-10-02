import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './useAutosave';

// A write that answers when the test says so.
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

const setup = (options = {}) => renderHook(() => useAutosave({ errorMessage: error => `FR: ${error.message}`, ...options }));

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('debounce coalesces a burst into one write, of the last value', async () => {
  const writes = [];
  const { result } = setup();
  act(() => {
    [3, 4, 5, 6, 7].forEach(value => result.current.debounce('place-1', async () => { writes.push(value); return {}; }));
  });
  expect(result.current.status).toBe('saving');
  await act(async () => { jest.advanceTimersByTime(400); });
  expect(writes).toEqual([7]);
  expect(result.current.status).toBe('saved');
});

test('writes for one key go out in order, even when they answer out of order; other keys run alongside', async () => {
  const log = [];
  const first = deferred();
  const second = deferred();
  const { result } = setup();
  let a;
  let b;
  await act(async () => {
    a = result.current.run('place-1', () => { log.push('a starts'); return first.promise; });
    b = result.current.run('place-1', () => { log.push('b starts'); return second.promise; });
    result.current.run('place-2', async () => { log.push('other'); return {}; });
  });
  expect(log).toEqual(['a starts', 'other']);
  await act(async () => { second.resolve({}); });
  expect(log).toEqual(['a starts', 'other']);
  await act(async () => { first.resolve({}); await a; await b; });
  expect(log).toEqual(['a starts', 'other', 'b starts']);
  expect(result.current.status).toBe('saved');
});

test('build is called at its turn, so it writes what is current then', async () => {
  const gate = deferred();
  let shown = 'off';
  const written = [];
  const { result } = setup();
  await act(async () => {
    result.current.run('place-1', () => gate.promise);
    result.current.run('place-1', async () => { written.push(shown); return {}; });
  });
  shown = 'on';
  await act(async () => { gate.resolve({}); });
  expect(written).toEqual(['on']);
});

test('a failure shows in French, calls onFailure, and the next success clears it', async () => {
  const onFailure = jest.fn();
  const onSuccess = jest.fn();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const { result } = setup({ onFailure, onSuccess });
  await act(async () => { await result.current.run('k', async () => ({ error: { message: 'place_exclusion_occupied' } })); });
  expect(result.current.error).toBe('FR: place_exclusion_occupied');
  expect(result.current.status).toBe('idle');
  expect(onFailure).toHaveBeenCalledTimes(1);
  expect(onSuccess).not.toHaveBeenCalled();

  await act(async () => { await result.current.run('k', async () => ({})); });
  expect(result.current.error).toBeNull();
  expect(onSuccess).toHaveBeenCalledTimes(1);
  console.error.mockRestore();
});

test('a write that throws is a failure, and the queue goes on', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const after = jest.fn(async () => ({}));
  const { result } = setup();
  await act(async () => {
    result.current.run('k', async () => { throw new Error('network'); });
    await result.current.run('k', after);
  });
  expect(after).toHaveBeenCalled();
  expect(result.current.status).toBe('saved');
  console.error.mockRestore();
});

test('drop forgets the waiting writes, and claims nothing was saved', async () => {
  const write = jest.fn(async () => ({}));
  const { result } = setup();
  act(() => result.current.debounce('k', write));
  act(() => result.current.drop());
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(write).not.toHaveBeenCalled();
  expect(result.current.status).toBe('idle');
});

test('leaving the editor sends the waiting writes', async () => {
  const write = jest.fn(async () => ({}));
  const onSuccess = jest.fn();
  const { result, unmount } = setup({ onSuccess });
  act(() => result.current.debounce('k', write));
  unmount();
  await act(async () => {});
  expect(write).toHaveBeenCalledTimes(1);
  expect(onSuccess).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(write).toHaveBeenCalledTimes(1);
});
