import fr from '../locales/fr.json';
import { supabase } from './supabase';
import { appError } from './dbErrors';

// A location's photo (#124) lives in the public location-photos bucket; locations.photo_path is
// its object name. Only admins can write the bucket (storage.objects policies).
const BUCKET = 'location-photos';

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

/** The public URL of a location's photo, or null when it has none. */
export const locationPhotoUrl = (path) => (path ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null);

// The picked image, scaled down and re-encoded as JPEG. An image the browser can't decode (HEIC on
// a desktop browser, a file that isn't an image) is refused with a French message.
const shrink = async (file) => {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw appError(fr.locationPhotoUnreadable);
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw appError(fr.locationPhotoUnreadable);
  return blob;
};

/**
 * Uploads a photo for a location and returns its object name, to be saved in
 * locations.photo_path. The name is new each time: a replaced photo may still be an archived
 * edition's (its frozen copy points at the same object).
 * @returns {Promise<string>}
 */
export const uploadLocationPhoto = async (locationId, file) => {
  const blob = await shrink(file);
  const path = `${locationId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return path;
};

/**
 * Removes the photos no location points at any more: those named (a photo just replaced or
 * removed, the one of a location just deleted, one uploaded for a save that failed), and any left
 * behind earlier. The database says which (unused_location_photos); it can't delete a Storage
 * object itself. A failure is only logged: the next call takes what this one left.
 * @param {Array<string | null | undefined>} paths
 */
export const removeUnusedLocationPhotos = async (paths = []) => {
  const { data, error } = await supabase.rpc('unused_location_photos', { p_paths: paths.filter(Boolean) });
  if (error) return console.error('Error listing unused location photos:', error);
  if (!data.length) return;
  const { error: removeError } = await supabase.storage.from(BUCKET).remove(data);
  if (removeError) console.error('Error removing unused location photos:', removeError);
};
