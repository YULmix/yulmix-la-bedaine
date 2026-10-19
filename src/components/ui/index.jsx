// Shared UI primitives. Every visual value comes from the tokens in src/index.css, which are
// derived from the locked design language in .ulpi/design/DESIGN.md. Build screens out of these
// instead of re-styling raw elements, so the same control never looks different in two places.
import { useEffect, useId, useRef } from 'react';
import { Check, Loader2, Minus, Plus, X } from 'lucide-react';
import fr from '../../locales/fr.json';

const cx = (...classes) => classes.filter(Boolean).join(' ');
export { cx };

// ---------------------------------------------------------------------------------------------
// Button

const BUTTON_VARIANTS = {
  primary: 'bg-neon text-night hover:brightness-110',
  secondary: 'border border-edge text-ink hover:bg-raised',
  ghost: 'text-muted hover:text-ink hover:bg-raised',
  danger: 'bg-bad text-night hover:brightness-110',
  dangerGhost: 'text-bad hover:tint-bad'
};

const BUTTON_SIZES = {
  md: 'min-h-11 px-5 text-base gap-2',
  sm: 'min-h-9 px-3 text-sm gap-1.5',
  icon: 'size-11 justify-center'
};

export const Button = ({ variant = 'primary', size = 'md', className, type = 'button', loading = false, disabled, children, ...props }) => (
  <button
    type={type}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    className={cx(
      'inline-flex items-center justify-center rounded-control font-semibold whitespace-nowrap',
      'transition duration-150 ease-out active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none',
      BUTTON_VARIANTS[variant],
      BUTTON_SIZES[size],
      className
    )}
    {...props}
  >
    {loading && <Loader2 aria-hidden="true" className="size-4.5 shrink-0 animate-spin" />}
    {children}
  </button>
);

// ---------------------------------------------------------------------------------------------
// Form fields

const CONTROL = 'w-full rounded-control border border-edge bg-night px-3.5 py-2.5 text-base text-ink placeholder:text-faint transition duration-150 focus:border-neon focus:outline-none focus:ring-2 focus:ring-neon/40 aria-[invalid=true]:border-bad';

export const Field = ({ label, hint, error, children, className, htmlFor }) => {
  const fallbackId = useId();
  const id = htmlFor || fallbackId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      {label && <label htmlFor={id} className="text-sm font-semibold text-muted">{label}</label>}
      {typeof children === 'function' ? children({ id, describedBy, invalid: !!error }) : children}
      {hint && <p id={hintId} className="text-sm text-faint">{hint}</p>}
      {error && <p id={errorId} className="text-sm text-bad">{error}</p>}
    </div>
  );
};

export const Input = ({ className, invalid, ...props }) => (
  <input className={cx(CONTROL, className)} aria-invalid={invalid || undefined} {...props} />
);

export const Textarea = ({ className, invalid, rows = 3, ...props }) => (
  <textarea rows={rows} className={cx(CONTROL, 'resize-y', className)} aria-invalid={invalid || undefined} {...props} />
);

export const Select = ({ className, children, ...props }) => (
  <select className={cx(CONTROL, 'appearance-none pr-10', className)} {...props}>{children}</select>
);

// Visible label + group of selectable pills. Single mode renders radios, multi renders checkboxes,
// so arrow keys, Space and screen-reader semantics come from the platform.
export const ChipGroup = ({ label, options, value, onChange, multiple = false, name, className, size = 'md', hideLabel = false }) => {
  const groupId = useId();
  const inputName = name || groupId;
  const isSelected = (optionValue) => (multiple ? (value || []).includes(optionValue) : value === optionValue);
  const toggle = (optionValue) => {
    if (!multiple) return onChange(optionValue);
    const current = value || [];
    onChange(current.includes(optionValue) ? current.filter(v => v !== optionValue) : [...current, optionValue]);
  };
  return (
    <fieldset className={cx('min-w-0', className)}>
      {label && (
        <legend className={cx('mb-2 text-sm font-semibold text-muted', hideLabel && 'sr-only')}>{label}</legend>
      )}
      <div className="flex flex-wrap gap-2">
        {options.map(option => {
          const selected = isSelected(option.value);
          const Icon = option.icon;
          return (
            <label
              key={option.value}
              className={cx(
                'relative inline-flex cursor-pointer select-none items-center gap-2 rounded-control border transition duration-150 ease-out active:scale-[0.98]',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-neon',
                size === 'sm' ? 'min-h-9 px-3 text-sm' : 'min-h-11 px-4 text-base',
                selected ? 'border-neon tint-neon text-ink' : 'border-edge text-muted hover:border-muted hover:text-ink'
              )}
            >
              <input
                type={multiple ? 'checkbox' : 'radio'}
                name={inputName}
                value={option.value}
                checked={selected}
                onChange={() => toggle(option.value)}
                className="sr-only"
              />
              {Icon && <Icon aria-hidden="true" className={cx('size-4.5 shrink-0', selected ? 'text-neon' : 'text-faint')} strokeWidth={1.75} />}
              <span>{option.label}</span>
              {multiple && selected && <Check aria-hidden="true" className="size-4 text-neon" strokeWidth={2.25} />}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
};

// `switchLabel` names the switch when the visible label alone wouldn't say what it does (a list
// of them); `aside` goes between the text and the switch.
export const Toggle = ({ checked, onChange, label, description, disabled, className, switchLabel, aside }) => {
  const id = useId();
  return (
    <div className={cx('flex items-center justify-between gap-4', className)}>
      <div className="min-w-0 flex-1">
        <span id={`${id}-label`} className="block text-base text-ink">{label}</span>
        {description && <span className="block text-sm text-faint">{description}</span>}
      </div>
      {aside}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={switchLabel}
        aria-labelledby={switchLabel ? undefined : `${id}-label`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="relative inline-flex h-11 w-14 shrink-0 items-center justify-center disabled:opacity-50"
      >
        <span className={cx('absolute h-7 w-12 rounded-full transition duration-250 ease-out', checked ? 'bg-neon' : 'bg-line')} />
        <span className={cx('absolute size-5 rounded-full bg-ink transition duration-250 ease-out', checked ? 'translate-x-2.5' : '-translate-x-2.5')} />
      </button>
    </div>
  );
};

export const Stepper = ({ value, onChange, min = 0, max = 99, label, id }) => (
  <div className="inline-flex items-center rounded-control border border-edge bg-night" role="group" aria-label={label}>
    <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={fr.stepperLess} className="grid size-11 place-items-center text-muted hover:text-ink disabled:opacity-40">
      <Minus className="size-4" aria-hidden="true" />
    </button>
    <output id={id} aria-live="polite" className="min-w-10 text-center font-data text-base text-ink">{value}</output>
    <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={fr.stepperMore} className="grid size-11 place-items-center text-muted hover:text-ink disabled:opacity-40">
      <Plus className="size-4" aria-hidden="true" />
    </button>
  </div>
);

// ---------------------------------------------------------------------------------------------
// Display

const TAG_TONES = {
  ok: 'text-ok tint-ok',
  warn: 'text-warn tint-warn',
  bad: 'text-bad tint-bad',
  info: 'text-info tint-info',
  neon: 'text-neon tint-neon',
  neutral: 'text-muted bg-raised'
};

export const Tag = ({ tone = 'neutral', icon: Icon, children, className }) => (
  <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold whitespace-nowrap', TAG_TONES[tone], className)}>
    {Icon && <Icon aria-hidden="true" className="size-3.5" strokeWidth={2} />}
    {children}
  </span>
);

export const tagToneClass = (tone) => TAG_TONES[tone];

export const Card = ({ as: Component = 'section', className, children, ...props }) => (
  <Component className={cx('rounded-card border border-line bg-surface', className)} {...props}>{children}</Component>
);

export const SectionTitle = ({ as: Component = 'h2', children, action, className }) => (
  <div className={cx('flex items-center justify-between gap-4', className)}>
    <Component className="text-lg font-semibold text-ink">{children}</Component>
    {action}
  </div>
);

const NOTICE_TONES = {
  ok: 'border-ok/40 tint-ok',
  warn: 'border-warn/40 tint-warn',
  bad: 'border-bad/40 tint-bad',
  info: 'border-info/40 tint-info'
};
const NOTICE_ICON_TONES = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', info: 'text-info' };

export const Notice = ({ tone = 'info', icon: Icon, title, children, action, className, role }) => (
  <div role={role || (tone === 'bad' ? 'alert' : undefined)} className={cx('flex items-start gap-3 rounded-control border px-4 py-3', NOTICE_TONES[tone], className)}>
    {Icon && <Icon aria-hidden="true" className={cx('mt-0.5 size-5 shrink-0', NOTICE_ICON_TONES[tone])} strokeWidth={1.75} />}
    <div className="min-w-0 flex-1 text-sm text-ink">
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? 'mt-0.5 text-muted' : ''}>{children}</div>}
    </div>
    {action}
  </div>
);

export const EmptyState = ({ icon: Icon, title, children, action, className }) => (
  <div className={cx('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
    {Icon && (
      <span className="grid size-14 place-items-center rounded-full bg-raised text-neon">
        <Icon aria-hidden="true" className="size-6" strokeWidth={1.75} />
      </span>
    )}
    <h3 className="text-lg font-semibold text-ink">{title}</h3>
    {children && <p className="max-w-md text-muted">{children}</p>}
    {action && <div className="mt-2">{action}</div>}
  </div>
);

export const Skeleton = ({ className }) => (
  <div aria-hidden="true" className={cx('animate-pulse rounded-control bg-raised', className)} />
);

const STAT_TONES = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', neon: 'text-neon', info: 'text-info' };

export const Stat = ({ label, value, hint, tone }) => (
  <div className="min-w-0">
    <p className="text-sm text-muted">{label}</p>
    <p className={cx('mt-1 font-data text-2xl font-medium', STAT_TONES[tone] || 'text-ink')}>{value}</p>
    {hint && <p className="mt-0.5 text-sm text-faint">{hint}</p>}
  </div>
);

// ---------------------------------------------------------------------------------------------
// Dialog: native <dialog> opened with showModal(), so focus trapping, Escape and the top layer
// come from the platform. Centered from sm up, bottom sheet below.

export const Dialog = ({ open, onClose, title, children, footer, size = 'md', dismissible = true, className }) => {
  const ref = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleCancel = (event) => {
      event.preventDefault();
      if (dismissible) onClose?.();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [onClose, dismissible]);

  const widths = { sm: 'sm:max-w-md', md: 'sm:max-w-2xl', lg: 'sm:max-w-4xl', xl: 'sm:max-w-5xl' };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClick={(event) => { if (dismissible && event.target === ref.current) onClose?.(); }}
      className={cx(
        'm-0 mt-auto w-full max-w-none max-h-[92dvh] overflow-hidden rounded-t-card border border-line bg-surface p-0 text-ink shadow-pop',
        'sm:m-auto sm:rounded-card',
        widths[size],
        open && 'animate-sheet',
        className
      )}
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3 sm:px-6">
            <h2 id={titleId} className="text-lg font-semibold text-ink">{title}</h2>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label={fr.close} className="-mr-2">
              <X className="size-5" aria-hidden="true" />
            </Button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-3 border-t border-line px-5 py-3 sm:px-6 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
};

// Replaces window.confirm(): focus lands on Cancel so Enter never confirms a destructive action.
export const ConfirmDialog = ({ open, title, children, confirmLabel, onConfirm, onCancel, tone = 'danger', loading = false }) => (
  <Dialog
    open={open}
    onClose={onCancel}
    title={title}
    size="sm"
    footer={(
      <>
        <Button variant="secondary" onClick={onCancel} autoFocus>{fr.cancel}</Button>
        <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
      </>
    )}
  >
    <div className="px-5 py-5 text-muted sm:px-6">{children}</div>
  </Dialog>
);

// Switches between the views of one admin tab (Logistique, Inscrits): pills in a tablist, the
// view's id in the URL (?view=). `views` is [{ id, label, icon, badge? }]; `idPrefix` makes the
// tab and panel ids (`${idPrefix}-${id}`, `${idPrefix}-${id}-panel`). Arrow keys, Home and End
// move between views (automatic activation), as in the admin tab bar. Scrolls sideways on its own
// when the pills don't fit (phones), never the page.
export const ViewTabs = ({ views, value, onChange, label, idPrefix }) => {
  const tabId = id => `${idPrefix}-${id}`;
  const index = views.findIndex(view => view.id === value);
  const select = (id) => {
    onChange(id);
    requestAnimationFrame(() => {
      const tab = document.getElementById(tabId(id));
      tab?.focus();
      tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  };
  const handleKeyDown = (event) => {
    const keys = { ArrowRight: 1, ArrowLeft: -1 };
    if (!(event.key in keys) && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    let next = index + (keys[event.key] || 0);
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = views.length - 1;
    select(views[(next + views.length) % views.length].id);
  };
  return (
    <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <div role="tablist" aria-label={label} onKeyDown={handleKeyDown}
        className="inline-flex gap-1 rounded-full border border-line bg-surface p-1">
        {views.map(({ id, label: viewLabel, icon: Icon, badge }) => {
          const selected = id === value;
          return (
            <button key={id} type="button" role="tab" id={tabId(id)} aria-selected={selected}
              aria-controls={`${tabId(id)}-panel`} tabIndex={selected ? 0 : -1} onClick={() => select(id)}
              className={cx(
                'inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-semibold transition duration-150',
                selected ? 'tint-neon text-ink' : 'text-faint hover:text-ink'
              )}>
              <Icon aria-hidden="true" className={cx('size-4.5', selected && 'text-neon')} strokeWidth={1.75} />
              {viewLabel}
              {badge}
            </button>
          );
        })}
      </div>
    </div>
  );
};

/** The panel that goes with ViewTabs: same idPrefix and value. */
export const ViewPanel = ({ idPrefix, value, children, className }) => (
  <div role="tabpanel" id={`${idPrefix}-${value}-panel`} aria-labelledby={`${idPrefix}-${value}`} key={value} className={cx('animate-step', className)}>
    {children}
  </div>
);
