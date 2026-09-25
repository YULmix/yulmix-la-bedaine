// Builds a Google Maps search URL for a venue address string.
export const getGoogleMapsUrl = (address) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
