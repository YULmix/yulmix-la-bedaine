import { useLayoutEffect } from 'react';

// Caps a scrolling element's height so that, with the page scrolled to the top, its bottom (plus
// `reserve` px, e.g. its card's padding) ends on screen, above any fixed bottom bar
// ([data-bottom-bar], the admin's bottom bar on phones; hidden from md up, it measures 0). An inner scroll that runs past the bottom of the
// screen means two scrollbars fighting over the wheel; this keeps it to one. Where that would
// leave less than `min` px (a phone, under the controls above the list), the element isn't capped
// at all: no inner scroll, the page scrolls instead, still one scrollbar. Recomputed on resize,
// when `deps` change (e.g. once the list has loaded), and when the page's layout changes (a banner
// or a header settling above the element moves it down after the first measure).
export const useFitToViewport = (ref, { reserve = 0, min = 256, deps = [] } = {}) => {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const fit = () => {
      // Layout offsets, not getBoundingClientRect(): the panel's entry animation (animate-step)
      // translates it while this runs, and a transform would skew the measure.
      let top = 0;
      for (let node = element; node; node = node.offsetParent) top += node.offsetTop;
      const bar = document.querySelector('[data-bottom-bar]');
      const barHeight = bar && getComputedStyle(bar).position === 'fixed' ? bar.offsetHeight : 0;
      const available = window.innerHeight - top - barHeight - reserve;
      element.style.maxHeight = available >= min ? `${available}px` : 'none';
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
