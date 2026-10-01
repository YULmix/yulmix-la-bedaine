import { useLayoutEffect } from 'react';

// Caps a scrolling element's height so that, with the page scrolled to the top, its bottom (plus
// `reserve` px, e.g. its card's padding) ends on screen, above any fixed bottom bar
// ([data-bottom-bar], the admin tabs on phones). An inner scroll that runs past the bottom of the
// screen means two scrollbars fighting over the wheel; this keeps it to one. Where that would
// leave less than `min` px (a phone, under the controls above the list), the element isn't capped
// at all: no inner scroll, the page scrolls instead, still one scrollbar. Recomputed on resize and
// when `deps` change (e.g. once the list has loaded).
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
    return () => window.removeEventListener('resize', fit);
  }, deps);
};
