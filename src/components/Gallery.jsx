import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Images, X } from 'lucide-react';
import fr from '../locales/fr.json';
import { galleryImageUrl } from '../lib/galleries';
import { loadedIndexes, stepIndex, swipeOffset } from '../lib/carousel';
import { cx } from './ui';

const ROUND_BUTTON = 'grid size-12 place-items-center rounded-full border border-line bg-surface/85 text-ink shadow-pop backdrop-blur transition duration-150 hover:border-neon hover:text-neon focus-visible:outline-2 focus-visible:outline-neon';

// The carousel (#177): a modal dialog over the dimmed, blurred page, so focus stays inside, the
// page behind is inert and focus goes back to the button on close. The close button, a click on
// the background or Esc closes it; a click on the image doesn't, so a mis-tap while swiping can't.
// Arrows, swipes and the round buttons go round the images. Only the image shown and its two
// neighbours are loaded.
const GalleryCarousel = ({ images, name, startIndex, onClose }) => {
  const dialog = useRef(null);
  const touch = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [index, setIndex] = useState(startIndex);
  const count = images.length;
  const go = offset => setIndex(current => stepIndex(current, offset, count));

  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    const handleCancel = (event) => {
      event.preventDefault();
      closeRef.current();
    };
    element.addEventListener('cancel', handleCancel);
    return () => {
      element.removeEventListener('cancel', handleCancel);
      if (element.open) element.close();
    };
  }, []);

  const handleKeyDown = (event) => {
    if (count < 2) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); go(1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1); }
  };
  const handleTouchStart = (event) => {
    const { clientX, clientY } = event.touches[0];
    touch.current = { x: clientX, y: clientY };
  };
  const handleTouchEnd = (event) => {
    if (!touch.current || count < 2) return;
    const { clientX, clientY } = event.changedTouches[0];
    const offset = swipeOffset(clientX - touch.current.x, clientY - touch.current.y);
    touch.current = null;
    if (offset) go(offset);
  };

  const loaded = loadedIndexes(index, count);
  const counter = fr.galleryCounter.replace('{n}', index + 1).replace('{total}', count);

  return (
    <dialog
      ref={dialog}
      aria-label={fr.galleryDialogLabel.replace('{name}', name)}
      onKeyDown={handleKeyDown}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={(event) => { if (!event.target.closest('img, button')) onClose(); }}
      className="m-0 h-dvh max-h-none w-full max-w-none overflow-hidden bg-transparent p-0 text-ink backdrop:bg-night/80 backdrop:backdrop-blur-md"
    >
      <div className="flex h-full flex-col pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex justify-end p-3 sm:p-4">
          <button type="button" onClick={onClose} aria-label={fr.close} className={ROUND_BUTTON}>
            <X aria-hidden="true" className="size-5" strokeWidth={2} />
          </button>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-20">
          {images.map((image, i) => loaded.has(i) && (
            <img
              key={image.id}
              src={galleryImageUrl(image.path)}
              alt={fr.galleryImageAlt.replace('{name}', name).replace('{n}', i + 1).replace('{total}', count)}
              hidden={i !== index}
              draggable={false}
              className="animate-step max-h-full max-w-full rounded-card border border-line object-contain shadow-glow select-none"
            />
          ))}
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

        <p aria-live="polite" className="pt-4 text-center font-data text-sm text-muted">{counter}</p>
      </div>
    </dialog>
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
  const wasOpen = useRef(false);

  // Back to the button once the dialog is gone: while it's open, the rest of the page is inert.
  useEffect(() => {
    if (wasOpen.current && !open) button.current?.focus();
    wasOpen.current = open;
  }, [open]);

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
