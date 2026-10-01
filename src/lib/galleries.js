import fr from '../locales/fr.json';
import { supabase } from './supabase';
import { appError } from './dbErrors';

// Galleries (#177): ordered images owned by a location, or by a venue (one per kind). The images
// live in the public location-photos bucket (named for #124, it holds every gallery's); only
// admins can write it (storage.objects policies) and the gallery tables.
const BUCKET = 'location-photos';

/** The most images a gallery holds; the database refuses more (gallery_full). */
export const GALLERY_MAX = 30;

/** A venue's gallery kinds: English names, never shown. */
export const VENUE_GALLERY_KINDS = { general: 'general', assignments: 'assignments' };

// Phone photos are several megabytes; this is plenty to see a room, and well under the bucket's
// 5 MB limit.
const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.85;

/**
 * The size an image of width × height is drawn at so that neither side exceeds maxSide, keeping
 * its proportions. A smaller image keeps its size.
 * @returns {{ width: number, height: number }}
 */
export const fitWithin = (width, height, maxSide = MAX_SIDE) => {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
};

/** The public URL of a gallery image's object. */
export const galleryImageUrl = (path) => supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

/**
 * Of `count` picked files, how many fit in a gallery already holding `existing` images.
 * @returns {{ accepted: number, refused: number }}
 */
export const splitByRoom = (existing, count, max = GALLERY_MAX) => {
  const accepted = Math.max(0, Math.min(count, max - existing));
  return { accepted, refused: count - accepted };
};

// Gallery rows as read, with their images in order (cover first).
const GALLERY_COLUMNS = 'id, venue_id, location_id, kind, images:gallery_images(id, path, position)';
const withSortedImages = gallery => ({ ...gallery, images: [...gallery.images].sort((a, b) => a.position - b.position) });

/**
 * The galleries of these locations, as a Map from location id to its images in order. A location
 * without one (or one the reader can't see) is missing: an empty gallery.
 * @returns {Promise<Map<string, Array<{ id: string, path: string, position: number }>>>}
 */
export const fetchLocationGalleries = async (locationIds) => {
  if (!locationIds.length) return new Map();
  const { data, error } = await supabase.from('galleries').select(GALLERY_COLUMNS).in('location_id', locationIds);
  if (error) throw error;
  return new Map(data.map(gallery => [gallery.location_id, withSortedImages(gallery).images]));
};

/**
 * A venue's gallery of this kind, as its images in order; [] when it has none.
 * @returns {Promise<Array<{ id: string, path: string, position: number }>>}
 */
export const fetchVenueGallery = async (venueId, kind) => {
  const { data, error } = await supabase.from('galleries').select(GALLERY_COLUMNS)
    .eq('venue_id', venueId).eq('kind', kind).maybeSingle();
  if (error) throw error;
  return data ? withSortedImages(data).images : [];
};

// The picked image, scaled down and re-encoded as JPEG. An image the browser can't decode (HEIC on
// a desktop browser, a file that isn't an image) is refused with a French message.
const shrink = async (file) => {
  const unreadable = () => appError(fr.galleryImageUnreadable.replace('{file}', file.name));
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw unreadable();
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw unreadable();
  return blob;
};

/**
 * Adds one image at the end of a gallery: shrinks it, uploads it, then adds it to the location's
 * gallery (`{ locationId }`) or the venue's of a kind (`{ venueId, kind }`), created if need be.
 * Object names are new each time, under the owner's id. If the image can't be added, its object is
 * removed again.
 */
export const addGalleryImage = async (owner, file) => {
  const blob = await shrink(file);
  const path = `${owner.locationId || owner.venueId}/${crypto.randomUUID()}.jpg`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
  if (uploadError) throw uploadError;
  const { error } = await supabase.rpc('add_gallery_image', {
    p_path: path,
    p_location_id: owner.locationId ?? null,
    p_venue_id: owner.venueId ?? null,
    p_kind: owner.kind ?? null
  });
  if (error) {
    removeUnusedGalleryImages([path]);
    throw error;
  }
};

/** Points another location's gallery at the same objects as these images, in their order. */
export const copyGalleryImages = async (images, locationId) => {
  for (const image of images) {
    const { error } = await supabase.rpc('add_gallery_image', { p_path: image.path, p_location_id: locationId });
    if (error) throw error;
  }
};

/** Moves an image one step towards the cover (-1) or away from it (1). */
export const moveGalleryImage = (imageId, offset) => supabase.rpc('move_gallery_image', { p_image_id: imageId, p_offset: offset });

/** Removes an image from its gallery, then its object if no other gallery points at it. */
export const removeGalleryImage = async (image) => {
  const result = await supabase.from('gallery_images').delete().eq('id', image.id);
  if (!result.error) removeUnusedGalleryImages([image.path]);
  return result;
};

/**
 * Removes the objects no gallery image points at any more, frozen copies' included: those named
 * (an image just removed, the images of a location just deleted, an upload whose save failed), and
 * any left behind earlier. The database says which (unused_gallery_images); it can't delete a
 * Storage object itself. A failure is only logged: the next call takes what this one left.
 * @param {Array<string | null | undefined>} paths
 */
export const removeUnusedGalleryImages = async (paths = []) => {
  const { data, error } = await supabase.rpc('unused_gallery_images', { p_paths: paths.filter(Boolean) });
  if (error) return console.error('Error listing unused gallery images:', error);
  if (!data.length) return;
  const { error: removeError } = await supabase.storage.from(BUCKET).remove(data);
  if (removeError) console.error('Error removing unused gallery images:', removeError);
};
