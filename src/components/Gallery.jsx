import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Images, PinOff, X } from 'lucide-react';
import fr from '../locales/fr.json';
import { galleryImageUrl } from '../lib/galleries';
import { loadedIndexes, stepIndex, swipeOffset } from '../lib/carousel';
import { cx } from './ui';

const ROUND = 'grid place-items-center rounded-full border border-line bg-surface/85 text-ink shadow-pop backdrop-blur transition duration-150 hover:border-neon hover:text-neon focus-visible:outline-2 focus-visible:outline-neon';
const ROUND_BUTTON = cx(ROUND, 'size-12');
const SMALL_ROUND_BUTTON = cx(ROUND, 'size-11');

// What the carousel and the pinned strip share (#177, #293): the image shown, and the arrow
// keys' and swipes' steps round the gallery. The index stays in range if the gallery shrinks.
const useGalleryIndex = (count, startIndex = 0) => {
  const touch = useRef(null);
  const [rawIndex, setIndex] = useState(startIndex);
  const index = count ? Math.min(rawIndex, count - 1) : 0;
  const go = offset => setIndex(current => stepIndex(count ? Math.min(current, count - 1) : 0, offset, count));
  const onKeyDown = (event) => {
    if (count < 2) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); go(1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1); }
  };
  const onTouchStart = (event) => {
    const { clientX, clientY } = event.touches[0];
    touch.current = { x: clientX, y: clientY };
  };
  const onTouchEnd = (event) => {
    if (!touch.current || count < 2) return;
    const { clientX, clientY } = event.changedTouches[0];
    const offset = swipeOffset(clientX - touch.current.x, clientY - touch.current.y);
    touch.current = null;
    if (offset) go(offset);
  };
  return { index, setIndex, go, handlers: { onKeyDown, onTouchStart, onTouchEnd } };
};

// The image shown and its two neighbours (the others aren't loaded), only the shown one visible.
const GallerySlides = ({ images, name, index, className }) => {
  const loaded = loadedIndexes(index, images.length);
  return images.map((image, i) => loaded.has(i) && (
    <img
      key={image.id}
      src={galleryImageUrl(image.path)}
      alt={fr.galleryImageAlt.replace('{name}', name).replace('{n}', i + 1).replace('{total}', images.length)}
      hidden={i !== index}
      draggable={false}
      className={cx('max-h-full max-w-full object-contain select-none', className)}
    />
  ));
};

const counterText = (index, count) => fr.galleryCounter.replace('{n}', index + 1).replace('{total}', count);

// Puts focus back on `ref` once `open` turns false: while the carousel is open the rest of the
// page is inert, so the browser can't.
const useFocusOnClose = (open, ref) => {
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) ref.current?.focus();
    wasOpen.current = open;
  }, [open, ref]);
};

// The carousel (#177): a modal dialog over the dimmed, blurred page, so focus stays inside, the
// page behind is inert and focus goes back to the button on close. The close button, a click on
// the background or Esc closes it; a click on the image doesn't, so a mis-tap while swiping can't.
// Arrows, swipes and the round buttons go round the images. Only the image shown and its two
// neighbours are loaded. `onClose` receives the index shown last.
const GalleryCarousel = ({ images, name, startIndex, onClose }) => {
  const dialog = useRef(null);
  const count = images.length;
  const { index, go, handlers } = useGalleryIndex(count, startIndex);
  const indexRef = useRef(index);
  indexRef.current = index;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const close = () => closeRef.current(indexRef.current);

  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    const handleCancel = (event) => {
      event.preventDefault();
      closeRef.current(indexRef.current);
    };
    element.addEventListener('cancel', handleCancel);
    return () => {
      element.removeEventListener('cancel', handleCancel);
      if (element.open) element.close();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-label={fr.galleryDialogLabel.replace('{name}', name)}
      {...handlers}
      onClick={(event) => { if (!event.target.closest('img, button')) close(); }}
      className="m-0 h-dvh max-h-none w-full max-w-none overflow-hidden bg-transparent p-0 text-ink backdrop:bg-night/80 backdrop:backdrop-blur-md"
    >
      <div className="flex h-full flex-col pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex justify-end p-3 sm:p-4">
          <button type="button" onClick={close} aria-label={fr.close} className={ROUND_BUTTON}>
            <X aria-hidden="true" className="size-5" strokeWidth={2} />
          </button>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-20">
          <GallerySlides images={images} name={name} index={index} className="animate-step rounded-card border border-line shadow-glow" />
          {count > 1 && (
            <>
              <button type="button" onClick={() => go(-1)} aria-label={fr.galleryPrevious}
                className={cx(ROUND_BUTTON, 'absolute top-1/2 left-3 -translate-y-1/2 sm:left-4')}>
                <ChevronLeft aria-hidden="true" className="size-6" strokeWidth={2} />
              </button>
              <button type="button" onClick={() => go(1)} aria-label={fr.galleryNext}
                className={cx(ROUND_BUTTON, 'absolute top-1/2 right-3 -translate-y-1/2 sm:right-4')}>
                <ChevronRight aria-hidden="true" className="size-6" strokeWidth={2} />
              </button>
            </>
          )}
        </div>

        <p aria-live="polite" className="pt-4 text-center font-data text-sm text-muted">{counterText(index, count)}</p>
      </div>
    </dialog>
  );
};

/**
 * A gallery pinned inline (#293): the shown image whole, at a capped height (a quarter of the
 * screen on phones, a third from sm up), stuck under the app's header (--header-height, which
 * also counts the « Voir comme » banner) while the page scrolls under it. Arrows, arrow keys and
 * swipes change the image; a tap on it opens the carousel there, which hands back the image it
 * closed on. `onUnpin` is the strip's own « Détacher » button. An empty gallery renders nothing.
 * @param {{ images: Array<{ id: string, path: string }>, name: string, onUnpin: () => void }} props
 */
export const GalleryStrip = ({ images, name, onUnpin }) => {
  const count = images?.length ?? 0;
  const { index, setIndex, go, handlers } = useGalleryIndex(count);
  const [open, setOpen] = useState(false);
  const enlarge = useRef(null);
  useFocusOnClose(open, enlarge);

  if (!count) return null;

  const close = (shown) => {
    setIndex(shown);
    setOpen(false);
  };

  return (
    // The opaque band around the frame hides the cards scrolling under it.
    <div className="sticky top-(--header-height,4rem) z-20 -mt-1 bg-night pt-1 pb-3">
      <div role="region" aria-label={fr.galleryStripLabel.replace('{name}', name)} {...handlers}
        className="relative h-[25svh] overflow-hidden rounded-card border border-line bg-surface sm:h-[35vh]">
        <button
          ref={enlarge}
          type="button"
          onClick={() => setOpen(true)}
          aria-label={fr.galleryStripEnlarge.replace('{n}', index + 1).replace('{total}', count)}
          className="flex size-full cursor-zoom-in items-center justify-center p-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-neon"
        >
          <GallerySlides images={images} name={name} index={index} className="rounded-control" />
        </button>
        {count > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label={fr.galleryPrevious}
              className={cx(SMALL_ROUND_BUTTON, 'absolute top-1/2 left-2 -translate-y-1/2')}>
              <ChevronLeft aria-hidden="true" className="size-5" strokeWidth={2} />
            </button>
            <button type="button" onClick={() => go(1)} aria-label={fr.galleryNext}
              className={cx(SMALL_ROUND_BUTTON, 'absolute top-1/2 right-2 -translate-y-1/2')}>
              <ChevronRight aria-hidden="true" className="size-5" strokeWidth={2} />
            </button>
            <p aria-live="polite" className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-night/85 px-2 py-0.5 font-data text-xs text-ink">
              {counterText(index, count)}
            </p>
          </>
        )}
        <button type="button" onClick={onUnpin} aria-label={fr.galleryUnpin} title={fr.galleryUnpin}
          className={cx(SMALL_ROUND_BUTTON, 'absolute top-2 right-2')}>
          <PinOff aria-hidden="true" className="size-5" strokeWidth={2} />
        </button>
      </div>
      {open && <GalleryCarousel images={images} name={name} startIndex={index} onClose={close} />}
    </div>
  );
};

/**
 * A gallery's button (#177), the same everywhere: its cover with a badge counting the photos,
 * opening the carousel. An empty gallery renders nothing.
 * @param {{ images: Array<{ id: string, path: string }>, name: string, size?: 'sm' | 'md', className?: string }} props
 */
const GalleryButton = ({ images, name, size = 'md', className }) => {
  const [open, setOpen] = useState(false);
  const button = useRef(null);
  useFocusOnClose(open, button);

  if (!images?.length) return null;

  const close = () => setOpen(false);

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={fr.galleryOpen.replace('{name}', name).replace('{count}', images.length)}
        className={cx(
          'group relative block shrink-0 overflow-hidden rounded-control border border-line transition duration-150 hover:border-neon hover:shadow-glow focus-visible:outline-2 focus-visible:outline-neon',
          size === 'sm' ? 'h-16 w-24' : 'h-24 w-36',
          className
        )}
      >
        <img src={galleryImageUrl(images[0].path)} alt="" loading="lazy" className="size-full object-cover transition duration-300 group-hover:scale-105" />
        <span aria-hidden="true" className="absolute right-1.5 bottom-1.5 inline-flex items-center gap-1 rounded-full bg-night/85 px-1.5 py-0.5 font-data text-xs text-ink">
          <Images className="size-3" strokeWidth={2} />{images.length}
        </span>
      </button>
      {open && <GalleryCarousel images={images} name={name} startIndex={0} onClose={close} />}
    </>
  );
};

export default GalleryButton;
