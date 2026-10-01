import { useCallback, useEffect, useRef, useState } from 'react';

// A capacity Stepper's writes go out this long after its last click, so tapping + five times is
// one write, not five racing ones.
export const AUTOSAVE_DELAY_MS = 400;

/**
 * Saving as the admin edits, for the editors that have no Save button (#193): Couchage (an event's
 * places) and Sites (a venue's layout).
 *
 * - `run(key, build)`: writes now. Writes with the same key go out one after the other, and
 *   `build` is only called when its turn comes, so it writes what the screen shows then: the
 *   last one written is the last one made. Returns the write's `{ data, error }`.
 * - `debounce(key, build, delayMs)`: writes after `delayMs` without another call for that key;
 *   only the last `build` runs.
 * - `drop()`: forgets the writes still waiting (a venue change clears what they'd write).
 * - `status`: 'idle' until a write, 'saving' while any is waiting or running, 'saved' once they're
 *   all done; back to 'idle' on a failure.
 * - `error`: the last failure in French (`errorMessage(error)`), cleared by the next success.
 *   `setError` lets the editor show its other errors in the same place.
 *
 * `build` returns a promise of `{ data, error }` (a Supabase query, or anything shaped like one).
 * On a failure `onFailure` runs (a reload, so the screen shows what the database holds); after a
 * success, `onSuccess`. Writes still waiting when the editor goes away are sent then, not lost.
 */
export const useAutosave = ({ errorMessage, onSuccess, onFailure }) => {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const queues = useRef(new Map());
  const timers = useRef(new Map());
  const running = useRef(0);
  // The latest callbacks, so writes queued earlier report through the current ones.
  const callbacks = useRef({ errorMessage, onSuccess, onFailure });
  callbacks.current = { errorMessage, onSuccess, onFailure };

  const settle = useCallback(() => {
    if (!running.current && !timers.current.size) setStatus('saved');
  }, []);

  const run = useCallback((key, build) => {
    running.current += 1;
    setStatus('saving');
    const turn = (queues.current.get(key) || Promise.resolve()).then(async () => {
      // A write that throws is a failed write, not a stuck queue.
      const result = await Promise.resolve().then(build).catch(thrown => ({ error: thrown }));
      running.current -= 1;
      if (result?.error) {
        console.error('Error saving:', result.error);
        setError(callbacks.current.errorMessage(result.error));
        setStatus('idle');
        await callbacks.current.onFailure?.();
      } else {
        setError(null);
        callbacks.current.onSuccess?.();
        settle();
      }
      return result || {};
    });
    queues.current.set(key, turn);
    return turn;
  }, [settle]);

  const debounce = useCallback((key, build, delayMs = AUTOSAVE_DELAY_MS) => {
    clearTimeout(timers.current.get(key)?.timer);
    setStatus('saving');
    const timer = setTimeout(() => {
      timers.current.delete(key);
      run(key, build);
    }, delayMs);
    timers.current.set(key, { timer, build });
  }, [run]);

  const drop = useCallback(() => {
    timers.current.forEach(({ timer }) => clearTimeout(timer));
    timers.current.clear();
    // Nothing was saved: not 'saved'.
    if (!running.current) setStatus(current => (current === 'saving' ? 'idle' : current));
  }, []);

  // Leaving the editor sends what is still waiting.
  useEffect(() => () => {
    timers.current.forEach(({ timer, build }) => {
      clearTimeout(timer);
      Promise.resolve(build()).then(result => {
        if (result?.error) console.error('Error saving:', result.error);
        else callbacks.current.onSuccess?.();
      });
    });
    timers.current.clear();
  }, []);

  return { status, error, setError, run, debounce, drop };
};
