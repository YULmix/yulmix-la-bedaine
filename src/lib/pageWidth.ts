// The two page widths (ADR 0022), shared by the admin shell and the member pages. A page sits in
// the app's one canvas (`CANVAS_CLASS`, used by the header, the footer, the member pages and the
// admin shell); the width says how much of it the page takes.

/** The one canvas: centred, clamped to max-w-screen-2xl, same horizontal padding everywhere. */
export const CANVAS_CLASS = 'mx-auto w-full max-w-screen-2xl px-4 md:px-6';

/**
 * How wide a page is: `dense` (lists, logs, tables) is the canvas's full width; `narrow` (forms,
 * summaries) has a max width of about 3xl.
 */
export type PageWidth = 'dense' | 'narrow';

/** The max-width class for a page width: none for `dense` (it fills the canvas). */
export const pageWidthClass = (width: PageWidth): string => (width === 'narrow' ? 'max-w-3xl' : '');
