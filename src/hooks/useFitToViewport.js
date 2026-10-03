import { useLayoutEffect } from 'react';

// Caps a scrolling element's height so that, with the page scrolled to the top, the whole page
// ends on screen: the element plus everything below it (its card's padding, the content area's
// padding, the site footer, the clearance for the phone bottom bar) fits in the viewport. An inner
// scroll next to a page scroll means two scrollbars fighting over the wheel; this keeps it to one.
// What is below is measured, not guessed: the page's height with the cap removed, minus the
// element's bottom edge. Where that would leave less than `min` px (a phone, under the controls
// above the list, or `fromWidth`), the element isn't capped at all: no inner scroll, the page
// scrolls instead, still one scrollbar. Recomputed on resize, when `deps` change (e.g. once the
// list has loaded), and when the page's layout changes (a banner or a header settling above the
// element moves it down after the first measure).
// `reserve`: extra px to leave below, if a caller needs more than the page has.
// `fromWidth`: below this viewport width the element is never capped.
export const useFitToViewport = (ref, { reserve = 0, min = 256, fromWidth = 0, deps = [] } = {}) => {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const fit = () => {
      // Measured uncapped.
      element.style.maxHeight = 'none';
      if (window.innerWidth < fromWidth) return;
      // Layout offsets, not getBoundingClientRect(): the panel's entry animation (animate-step)
      // translates it while this runs, and a transform would skew the measure.
      let top = 0;
      for (let node = element; node; node = node.offsetParent) top += node.offsetTop;
      const pageHeight = document.documentElement.scrollHeight;
      const below = pageHeight - top - element.offsetHeight;
      const available = Math.floor(window.innerHeight - top - below - reserve);
      // A page that already fits needs no cap.
      if (pageHeight > window.innerHeight && available >= min) element.style.maxHeight = `${available}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    // fit() only depends on where the element starts, so its own change of height re-fits to the
    // same value and the observer settles.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    observer?.observe(document.body);
    return () => {
      window.removeEventListener('resize', fit);
      observer?.disconnect();
    };
  }, deps);
};
