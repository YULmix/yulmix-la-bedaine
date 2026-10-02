import { useLayoutEffect, useRef } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import fr from '../locales/fr.json';
import { dismissToast, useToastList } from '../lib/toasts';

const TOAST_STYLES = {
  success: { icon: CheckCircle2, tone: 'text-ok', border: 'border-ok/40' },
  error: { icon: XCircle, tone: 'text-bad', border: 'border-bad/40' },
  warning: { icon: AlertTriangle, tone: 'text-warn', border: 'border-warn/40' },
  info: { icon: Info, tone: 'text-info', border: 'border-info/40' }
};

// The app-wide toasts (src/lib/toasts.ts), rendered once by the app shell: a bottom-center stack,
// above the sticky action bars and the admin tab bar, inside the thumb zone.
//
// It is a popover, shown again whenever a toast arrives, so it goes to the top of the top layer,
// above a modal <dialog> that is open (the admin's registration editor saves from one).
const ToastContainer = () => {
  const toasts = useToastList();
  const stackRef = useRef(null);
  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!stack?.showPopover) return;
    if (stack.matches(':popover-open')) stack.hidePopover();
    if (toasts.length) stack.showPopover();
  }, [toasts]);
  return (
    <div
      ref={stackRef}
      popover="manual"
      className="pointer-events-none fixed inset-x-0 top-auto bottom-24 z-70 m-0 flex h-auto w-auto flex-col items-center gap-2 overflow-visible border-0 bg-transparent px-4 py-0 text-ink md:bottom-6 [&:not(:popover-open)]:hidden"
    >
      {toasts.map(toast => {
        const style = TOAST_STYLES[toast.type] || TOAST_STYLES.info;
        const Icon = style.icon;
        return (
          <div
            key={toast.id}
            role={toast.type === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-control border ${style.border} bg-raised px-4 py-3 text-ink shadow-pop animate-sheet`}
          >
            <Icon aria-hidden="true" className={`mt-0.5 size-5 shrink-0 ${style.tone}`} strokeWidth={1.75} />
            <span className="flex-1 text-sm">{toast.message}</span>
            <button onClick={() => dismissToast(toast.id)} aria-label={fr.close} className="-m-2 grid size-9 place-items-center rounded-full text-faint hover:text-ink">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default ToastContainer;
