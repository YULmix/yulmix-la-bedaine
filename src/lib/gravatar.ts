// Gravatar URL for an email (#261): SHA-256 of the trimmed, lower-cased address, and `d=404` so an
// address without a Gravatar answers 404 (the Avatar then falls back to the initials) instead of a
// default picture. Async because crypto.subtle.digest is.
export const gravatarUrl = async (email: string, size: number): Promise<string> => {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=404`;
};
