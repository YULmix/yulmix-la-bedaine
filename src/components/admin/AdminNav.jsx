import { createContext, useContext, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ChevronRight, Ellipsis } from 'lucide-react';
import fr from '../../locales/fr.json';
import { adminHref, adminRoute } from '../../lib/adminRoutes';
import { ADMIN_SECTION_ENTRIES, BAR_SECTIONS, MORE_SECTIONS } from '../../lib/adminSections';
import { Dialog, cx } from '../ui';

// The admin navigation (#208, ADR 0022), all rendered from the section registry
// (src/lib/adminSections.ts): a sidebar from md up, with the current section's views nested
// under it; on phones a bottom bar with four sections and « Plus », a sheet with the rest; and
// the page header, one line with the page's title and its actions.

// `markers` maps a section id to the marker it shows (src/views/AdminView.jsx), or nothing.
// `value` is true for a dot (unsaved work) or a number for a count (unresolved feedback).
const Marker = ({ value, label = fr.unsavedTag, className }) => typeof value === 'number' ? (
  <span
    className={cx('flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-warn px-1 font-data text-[0.6875rem] font-semibold leading-none text-night', className)}
    aria-label={fr.adminFeedbackUnresolvedCount.replace('{count}', value)}
    title={fr.adminFeedbackUnresolvedCount.replace('{count}', value)}
  >{value}</span>
) : (
  <span className={cx('size-2 shrink-0 rounded-full bg-warn', className)} aria-label={label} title={label} />
);

const sectionHref = (section) => adminHref(adminRoute(section.id));
const viewHref = (section, view) => adminHref({ ...adminRoute(section.id), view: view.id });

/** Desktop (md and up): the sections, the current one's views nested under it. */
export const AdminSidebar = ({ page, markers, theme }) => (
  <nav aria-label={fr.adminTabsAriaLabel} className="hidden w-60 shrink-0 border-r border-line md:block">
    {/* Stuck under the header, whatever its height (--header-height, set by the header). */}
    <div className="sticky top-(--header-height,4rem) max-h-[calc(100dvh-var(--header-height,4rem))] overflow-y-auto px-3 py-5">
      {theme && <p className="truncate px-3 pb-3 font-data text-xs uppercase tracking-widest text-neon">{theme}</p>}
      <ul className="space-y-0.5">
        {ADMIN_SECTION_ENTRIES.map(section => {
          const active = section.id === page.section.id;
          const Icon = section.icon;
          // A section with views isn't itself the page: its current view is.
          const current = active && (section.views.length ? 'true' : 'page');
          return (
            <li key={section.id}>
              <Link
                to={sectionHref(section)}
                aria-current={current || undefined}
                className={cx(
                  'flex min-h-11 items-center gap-3 rounded-control px-3 text-sm transition duration-150',
                  active ? 'bg-raised font-semibold text-ink' : 'text-muted hover:bg-raised hover:text-ink'
                )}
              >
                <Icon aria-hidden="true" className={cx('size-4.5 shrink-0', active ? 'text-neon' : 'text-faint')} strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate">{fr[section.labelKey]}</span>
                {markers[section.id] && <Marker value={markers[section.id]} />}
              </Link>
              {active && section.views.length > 0 && (
                <ul className="mb-1 ml-7 mt-0.5">
                  {section.views.map(view => {
                    const viewActive = view.id === page.view?.id;
                    return (
                      <li key={view.id}>
                        <Link
                          to={viewHref(section, view)}
                          aria-current={viewActive ? 'page' : undefined}
                          className={cx(
                            'flex min-h-11 items-center gap-2 border-l-2 px-3 text-sm transition duration-150',
                            viewActive ? 'border-neon font-semibold text-ink' : 'border-line text-faint hover:text-ink'
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">{fr[view.labelKey]}</span>
                          {view.showsMarker && markers[section.id] && <Marker value={markers[section.id]} />}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  </nav>
);

const barItemClass = (active) => cx(
  'relative flex min-h-14 flex-col items-center justify-center gap-1 text-xs font-semibold transition duration-150',
  active ? 'text-neon' : 'text-faint hover:text-ink'
);

/**
 * Phones (below md): a fixed bottom bar in the thumb zone with the bar's sections and « Plus »,
 * a sheet with the others. « Plus » is highlighted when the current section is behind it, and
 * shows a marker when one of those sections has one.
 */
export const AdminBottomBar = ({ page, markers }) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  const moreActive = MORE_SECTIONS.some(section => section.id === page.section.id);
  const moreMarked = MORE_SECTIONS.some(section => markers[section.id]);
  // « Plus » says « Non enregistré » when unsaved work is behind it, and otherwise only that there is something to deal with.
  const moreUnsaved = MORE_SECTIONS.some(section => markers[section.id] === true);
  const closeMore = () => {
    setMoreOpen(false);
    // The native dialog gives focus back to what opened it; say so for the link that closed it.
    requestAnimationFrame(() => moreRef.current?.focus());
  };

  return (
    <>
      <nav
        aria-label={fr.adminTabsAriaLabel}
        data-bottom-bar
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-night/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        {BAR_SECTIONS.map(section => {
          const active = section.id === page.section.id;
          const Icon = section.icon;
          return (
            <Link key={section.id} to={sectionHref(section)} aria-label={fr[section.labelKey]}
              aria-current={active ? 'page' : undefined} className={barItemClass(active)}>
              <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
              <span aria-hidden="true">{fr[section.shortKey]}</span>
              {markers[section.id] && <Marker value={markers[section.id]} className="absolute right-[calc(50%-1.25rem)] top-2" />}
            </Link>
          );
        })}
        <button ref={moreRef} type="button" onClick={() => setMoreOpen(true)} aria-haspopup="dialog" aria-expanded={moreOpen}
          aria-current={moreActive ? 'true' : undefined} className={barItemClass(moreActive)}>
          <Ellipsis aria-hidden="true" className="size-5" strokeWidth={1.75} />
          <span>{fr.adminMore}</span>
          {moreMarked && <Marker value label={moreUnsaved ? fr.unsavedTag : fr.adminMoreMarked} className="absolute right-[calc(50%-1.25rem)] top-2" />}
        </button>
      </nav>

      <Dialog open={moreOpen} onClose={closeMore} title={fr.adminMore} size="sm">
        <ul className="divide-y divide-line pb-[env(safe-area-inset-bottom)]">
          {MORE_SECTIONS.map(section => {
            const active = section.id === page.section.id;
            const Icon = section.icon;
            return (
              <li key={section.id}>
                <Link to={sectionHref(section)} onClick={closeMore} aria-current={active ? 'page' : undefined}
                  className={cx(
                    'flex min-h-14 items-center gap-4 px-5 text-base transition duration-150 sm:px-6',
                    active ? 'font-semibold text-ink' : 'text-muted hover:bg-raised hover:text-ink'
                  )}>
                  <Icon aria-hidden="true" className={cx('size-5 shrink-0', active ? 'text-neon' : 'text-faint')} strokeWidth={1.75} />
                  <span className="min-w-0 flex-1">{fr[section.labelKey]}</span>
                  {markers[section.id] && <Marker value={markers[section.id]} />}
                  <ChevronRight aria-hidden="true" className="size-4.5 shrink-0 text-faint" />
                </Link>
              </li>
            );
          })}
        </ul>
      </Dialog>
    </>
  );
};

// Where a page's actions go: the right of its header line. A section renders
// <AdminHeaderActions> anywhere in its tree, and its children show there.
const HeaderActionsSlot = createContext(null);

export const AdminHeaderActions = ({ children }) => {
  const slot = useContext(HeaderActionsSlot);
  return slot ? createPortal(children, slot) : null;
};

/** Provides the header's actions slot to the page under it. */
export const AdminHeaderActionsProvider = ({ slot, children }) => (
  <HeaderActionsSlot.Provider value={slot}>{children}</HeaderActionsSlot.Provider>
);

/**
 * One line: the page's title (the section, and the view's after a dot) as its h1, and its
 * actions on the right. `slotRef` receives the actions' element.
 */
export const AdminPageHeader = ({ page, slotRef, theme }) => (
  <div className="mb-3 md:mb-4">
    {theme && <p className="truncate font-data text-xs uppercase tracking-widest text-neon md:hidden">{theme}</p>}
    <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2">
      <h1 id="admin-page-title" className="min-w-0 flex-1 font-display text-xl text-ink md:text-display-md">
        {fr[page.section.labelKey]}
        {page.view && <span className="text-faint"> · {fr[page.view.labelKey]}</span>}
      </h1>
      <div ref={slotRef} className="flex flex-wrap items-center gap-2 empty:hidden" />
    </div>
  </div>
);
