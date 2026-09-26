import { useState } from 'react';

const DEFAULT_DURATION_MS = 5000;

export const useToasts = (durationMs = DEFAULT_DURATION_MS) => {
  const [toasts, setToasts] = useState([]);

  const removeToast = (id) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  };

  const addToast = (message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => removeToast(id), durationMs);
  };

  return { toasts, addToast, removeToast };
};
