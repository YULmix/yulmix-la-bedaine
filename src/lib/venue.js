// An event's venue (#145) is embedded when events are read, so every page has its address.
export const EVENT_WITH_VENUE = '*, venue:venues(id, name, address)';

/** The address members see for an event: its venue's, or null. */
export const eventAddress = (event) => event?.venue?.address?.trim() || null;

// Builds a Google Maps search URL for a venue address string.
export const getGoogleMapsUrl = (address) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

/**
 * Coordinates as typed or pasted from a map, « 45.0050, -72.1000 » (#180): { lat, lng }, or
 * null when blank. undefined when it isn't a latitude and a longitude in range.
 */
export const parseCoordinates = (text) => {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  const match = /^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/.exec(trimmed);
  if (!match) return undefined;
  const [lat, lng] = [Number(match[1]), Number(match[2])];
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : undefined;
};

/** A venue's coordinates as shown in its field, « 45.005, -72.1 », or '' when it has none. */
export const formatCoordinates = (venue) => (venue?.lat == null || venue?.lng == null ? '' : `${venue.lat}, ${venue.lng}`);
