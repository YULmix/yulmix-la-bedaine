import { useSyncExternalStore } from 'react';

// Toasts (#195): one app-wide stack, shown by the one ToastContainer in the app shell. Anything
// can notify(), a store action or a screen, without a container of its own or an addToast prop.

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

export const DEFAULT_TOAST_DURATION_MS = 5000;

export const createToastStore = (schedule: (run: () => void, ms: number) => unknown = setTimeout) => {
  let toasts: Toast[] = [];
  let nextId = 1;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(listener => listener());

  const dismiss = (id: number): void => {
    if (!toasts.some(toast => toast.id === id)) return;
    toasts = toasts.filter(toast => toast.id !== id);
    emit();
  };

  /** Shows a toast for `durationMs`, then removes it; returns its id. */
  const notify = (message: string, type: ToastType = 'info', durationMs = DEFAULT_TOAST_DURATION_MS): number => {
    const id = nextId++;
    toasts = [...toasts, { id, message, type }];
    emit();
    schedule(() => dismiss(id), durationMs);
    return id;
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };

  return { notify, dismiss, subscribe, getToasts: (): Toast[] => toasts };
};

const store = createToastStore();

export const notify = store.notify;
export const dismissToast = store.dismiss;

/** The toasts on screen, for the app shell's ToastContainer. */
export const useToastList = (): Toast[] => useSyncExternalStore(store.subscribe, store.getToasts);
