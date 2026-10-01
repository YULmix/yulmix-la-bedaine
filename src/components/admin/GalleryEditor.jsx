import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, ImageOff, Trash2 } from 'lucide-react';
import fr from '../../locales/fr.json';
import { dbErrorMessage } from '../../lib/dbErrors';
import {
  GALLERY_MAX,
  addGalleryImage,
  fetchLocationGalleries,
  fetchVenueGallery,
  galleryImageUrl,
  moveGalleryImage,
  removeGalleryImage,
  splitByRoom
} from '../../lib/galleries';
import { Button, ConfirmDialog, Notice, Skeleton } from '../ui';

const fetchImages = async (owner) => (owner.locationId
  ? (await fetchLocationGalleries([owner.locationId])).get(owner.locationId) || []
  : fetchVenueGallery(owner.venueId, owner.kind));

// A gallery's editor (#177), on the venue's page of the Sites tab: the location's (`{ locationId }`)
// or the venue's of a kind (`{ venueId, kind }`). Several images can be picked at once; each is
// shrunk, uploaded and added in turn, and one that fails doesn't stop the others. The first image
// is the cover; arrows move an image, and removing one asks first. Every change is saved at once
// and reloads the gallery.
const GalleryEditor = ({ owner, title, hint, headingLevel: Heading = 'h3' }) => {
  const [images, setImages] = useState(null);
  const [progress, setProgress] = useState(null);
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [pendingRemove, setPendingRemove] = useState(null);
  const input = useRef(null);
  const headingId = useId();
  const { locationId, venueId, kind } = owner;

  const load = useCallback(async () => {
    try {
      setImages(await fetchImages({ locationId, venueId, kind }));
    } catch (loadError) {
      console.error('Error loading a gallery:', loadError);
      setErrors([fr.galleryLoadError]);
      setImages(current => current || []);
    }
  }, [locationId, venueId, kind]);

  useEffect(() => { load(); }, [load]);

  const upload = async (files) => {
    const { accepted, refused } = splitByRoom(images.length, files.length);
    const problems = refused ? [fr.galleryTooMany.replace('{max}', GALLERY_MAX).replace('{count}', refused)] : [];
    const toSend = files.slice(0, accepted);
    setErrors([]);
    for (const [i, file] of toSend.entries()) {
      setProgress({ n: i + 1, total: toSend.length });
      try {
        await addGalleryImage({ locationId, venueId, kind }, file);
      } catch (uploadError) {
        console.error('Error adding a gallery image:', uploadError);
        problems.push(dbErrorMessage(uploadError, fr.galleryUploadFailed.replace('{file}', file.name)));
      }
    }
    setProgress(null);
    setErrors(problems);
    await load();
  };

  const run = async (write) => {
    setBusy(true);
    const { error } = await write;
    if (error) {
      console.error('Error saving a gallery:', error);
      setErrors([dbErrorMessage(error, fr.gallerySaveError)]);
    } else {
      setErrors([]);
    }
    await load();
    setBusy(false);
  };

  const full = images && images.length >= GALLERY_MAX;
  const working = busy || !!progress;

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Heading id={headingId} className="font-semibold text-ink">{title}</Heading>
          {hint && <p className="text-sm text-faint">{hint}</p>}
        </div>
        <Button variant="secondary" size="sm" loading={!!progress} disabled={!images || full || busy} onClick={() => input.current.click()}>
          <Camera aria-hidden="true" className="size-4" strokeWidth={1.75} />{fr.galleryAdd}
        </Button>
        <input ref={input} type="file" accept="image/*" multiple hidden aria-label={`${fr.galleryInputLabel} : ${title}`}
          onChange={e => {
            const files = [...(e.target.files || [])];
            e.target.value = '';
            if (files.length) upload(files);
          }} />
      </div>

      <p role="status" className="font-data text-sm text-muted empty:hidden">
        {progress && fr.galleryUploading.replace('{n}', progress.n).replace('{total}', progress.total)}
        {!progress && full && fr.galleryFull.replace('{max}', GALLERY_MAX)}
      </p>

      {errors.length > 0 && (
        <Notice tone="bad" role="alert">
          {errors.length === 1 ? errors[0] : <ul className="list-disc pl-5">{errors.map((message, i) => <li key={i}>{message}</li>)}</ul>}
        </Notice>
      )}

      {!images ? (
        <Skeleton className="h-28 rounded-control" />
      ) : images.length === 0 ? (
        <div className="flex items-center gap-3 rounded-control border border-dashed border-line px-4 py-5 text-sm text-faint">
          <ImageOff aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.75} />{fr.galleryEmpty}
        </div>
      ) : (
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {images.map((image, i) => (
            <li key={image.id} className="overflow-hidden rounded-control border border-line bg-raised">
              <div className="relative">
                <img src={galleryImageUrl(image.path)} alt={fr.galleryImageAlt.replace('{name}', title).replace('{n}', i + 1).replace('{total}', images.length)}
                  loading="lazy" className="aspect-[4/3] w-full object-cover" />
                {i === 0 && (
                  <span className="absolute top-1.5 left-1.5 rounded-full bg-night/85 px-2 py-0.5 text-xs font-semibold text-neon">{fr.galleryCover}</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-1 p-1">
                <div className="flex">
                  <Button variant="ghost" size="icon" disabled={working || i === 0} onClick={() => run(moveGalleryImage(image.id, -1))}
                    aria-label={fr.galleryMoveEarlier.replace('{n}', i + 1)}>
                    <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.75} />
                  </Button>
                  <Button variant="ghost" size="icon" disabled={working || i === images.length - 1} onClick={() => run(moveGalleryImage(image.id, 1))}
                    aria-label={fr.galleryMoveLater.replace('{n}', i + 1)}>
                    <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.75} />
                  </Button>
                </div>
                <Button variant="dangerGhost" size="icon" disabled={working} onClick={() => setPendingRemove({ image, n: i + 1 })}
                  aria-label={fr.galleryRemove.replace('{n}', i + 1)}>
                  <Trash2 aria-hidden="true" className="size-4" strokeWidth={1.75} />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <ConfirmDialog
        open={!!pendingRemove}
        title={fr.galleryRemoveConfirmTitle}
        confirmLabel={fr.galleryRemoveAction}
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => {
          const { image } = pendingRemove;
          setPendingRemove(null);
          run(removeGalleryImage(image));
        }}
      >
        {pendingRemove && (
          <div className="flex items-center gap-4">
            <img src={galleryImageUrl(pendingRemove.image.path)} alt="" className="h-16 w-24 shrink-0 rounded-control border border-line object-cover" />
            <p>{fr.galleryRemoveConfirmBody.replace('{n}', pendingRemove.n)}</p>
          </div>
        )}
      </ConfirmDialog>
    </section>
  );
};

export default GalleryEditor;
