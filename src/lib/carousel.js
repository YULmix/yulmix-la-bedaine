// The gallery viewer's logic (#177), kept pure so it can be tested without a browser.

/** The image `offset` steps from `index` in a gallery of `count`, wrapping around both ends. */
export const stepIndex = (index, offset, count) => (count ? (((index + offset) % count) + count) % count : 0);

/** How far a finger has to travel sideways, in CSS pixels, for a swipe to change the image. */
export const SWIPE_THRESHOLD = 50;

/**
 * What a touch that moved by (dx, dy) does: 1 for the next image (swiped left), -1 for the previous
 * one (swiped right), 0 for nothing (too short, or more vertical than horizontal: a scroll).
 */
export const swipeOffset = (dx, dy, threshold = SWIPE_THRESHOLD) => {
  if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
};

/** The images worth loading while `index` shows: it and its neighbours, without repeats. */
export const loadedIndexes = (index, count) => new Set([index, stepIndex(index, 1, count), stepIndex(index, -1, count)].filter(i => i < count));
