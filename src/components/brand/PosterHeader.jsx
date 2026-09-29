import { CalendarDays, MapPin } from 'lucide-react';
import fr from '../../locales/fr.json';
import { eventAddress, getGoogleMapsUrl } from '../../lib/venue';
import { formatEventDates } from '../../lib/eventDisplay';
import { cx } from '../ui';

// The event as a gig poster: the UV mural behind a night scrim, theme in display type, and the
// facts on one mono line. `compact` is the sub-page variant (Infos pratiques, À propos).
const PosterHeader = ({ event, title, description, compact = false, children }) => {
  const heading = title || event?.theme;
  const text = description ?? event?.description;
  const dates = event ? formatEventDates(event) : '';
  const address = eventAddress(event);

  return (
    <header className={cx('relative isolate overflow-hidden rounded-card border border-line bg-surface animate-rise', compact ? 'min-h-44' : 'min-h-72 sm:min-h-80')}>
      <img
        src="/bedaine-mural.webp"
        alt=""
        aria-hidden="true"
        fetchPriority="high"
        className="absolute inset-0 -z-20 size-full object-cover object-[center_40%] opacity-70"
      />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(to_top,var(--color-night)_8%,color-mix(in_oklab,var(--color-night)_72%,transparent)_55%,color-mix(in_oklab,var(--color-night)_30%,transparent))]" />

      <div className={cx('flex h-full flex-col justify-end gap-3 p-5 sm:p-8', compact ? 'min-h-44' : 'min-h-72 sm:min-h-80')}>
        <p className="font-data text-xs uppercase tracking-widest text-muted">{fr.appTitle}</p>
        <h1 className={cx('font-display text-ink', compact ? 'text-display-md sm:text-4xl' : 'text-display-lg')}>{heading}</h1>
        {text && !compact && <p className="max-w-2xl text-base text-muted line-clamp-3">{text}</p>}
        {event && (dates || address) && (
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 font-data text-sm text-ink">
            {dates && (
              <li className="inline-flex items-center gap-2">
                <CalendarDays aria-hidden="true" className="size-4 text-neon" strokeWidth={1.75} />
                {dates}
              </li>
            )}
            {address && (
              <li className="min-w-0">
                <a
                  href={getGoogleMapsUrl(address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full items-center gap-2 underline decoration-edge underline-offset-4 hover:decoration-neon"
                >
                  <MapPin aria-hidden="true" className="size-4 shrink-0 text-neon" strokeWidth={1.75} />
                  <span className="truncate">{address}</span>
                </a>
              </li>
            )}
          </ul>
        )}
        {children && <div className="mt-2 flex flex-wrap gap-3">{children}</div>}
      </div>
    </header>
  );
};

export default PosterHeader;
