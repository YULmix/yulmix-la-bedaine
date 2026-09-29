// An event's venue (#145) is embedded when events are read, so every page has its address.
export const EVENT_WITH_VENUE = '*, venue:venues(id, name, address)';

/** The address members see for an event: its venue's, or null. */
export const eventAddress = (event) => event?.venue?.address?.trim() || null;

// Builds a Google Maps search URL for a venue address string.
export const getGoogleMapsUrl = (address) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
