import { useCallback } from 'react';
import { DEFAULT_TOAST_DURATION_MS, notify } from '../lib/toasts';

// A screen's way to show a toast in the app-wide stack (src/lib/toasts.ts), with its own default
// duration. The app shell renders the one ToastContainer.
export const useToasts = (durationMs = DEFAULT_TOAST_DURATION_MS) => {
  const addToast = useCallback((message, type = 'info') => notify(message, type, durationMs), [durationMs]);
  return { addToast };
};
