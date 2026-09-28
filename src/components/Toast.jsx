import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import fr from '../locales/fr.json';

const TOAST_STYLES = {
  success: { icon: CheckCircle2, tone: 'text-ok', border: 'border-ok/40' },
  error: { icon: XCircle, tone: 'text-bad', border: 'border-bad/40' },
  warning: { icon: AlertTriangle, tone: 'text-warn', border: 'border-warn/40' },
  info: { icon: Info, tone: 'text-info', border: 'border-info/40' }
};

// Bottom-center stack, above the sticky action bars and the admin tab bar, inside the thumb zone.
const ToastContainer = ({ toasts, onDismiss }) => (
  <div className="pointer-events-none fixed inset-x-0 bottom-24 z-70 flex flex-col items-center gap-2 px-4 md:bottom-6">
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
          <button onClick={() => onDismiss(toast.id)} aria-label={fr.close} className="-m-2 grid size-9 place-items-center rounded-full text-faint hover:text-ink">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      );
    })}
  </div>
);

export default ToastContainer;
