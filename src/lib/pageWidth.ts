// The two page widths (ADR 0022), shared by the admin shell and the member pages. A page sits in
// a centred, clamped canvas (the header's: max-w-6xl for members, max-w-screen-2xl for admin);
// the width says how much of it the page takes.

/**
 * How wide a page is: `dense` (lists, logs, tables) is the canvas's full width; `narrow` (forms,
 * summaries) has a max width of about 3xl.
 */
export type PageWidth = 'dense' | 'narrow';

/** The max-width class for a page width: none for `dense` (it fills the canvas). */
export const pageWidthClass = (width: PageWidth): string => (width === 'narrow' ? 'max-w-3xl' : '');
