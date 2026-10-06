// The Interac e-Transfer details members pay with: the one place they are written down (#301).
// Imported by the Edge Function's email templates (Deno) and by the React app (Vite), so it has
// no imports and no runtime APIs of either. Changing the recipient or the security question is a
// change to this file, reviewed in a PR.

/** The organisers' inbox: the Interac recipient, and the reply-to of the emails. */
export const INTERAC_RECIPIENT = 'yulmixalabedaine@gmail.com';

/** Interac's security question and its answer, in case the member's bank requires one. */
export const INTERAC_SECURITY_QUESTION = 'Événement';
export const INTERAC_SECURITY_ANSWER = 'Bedaine';

/** The note of the transfer, which tells the organisers whose payment it is. */
export const interacMessage = (name: string): string => `Inscription Bédaine - ${name}`;

/**
 * The name an account pays under: its full name, else the first attendee's, else its email.
 * The emails and the app both use this one rule.
 */
export const interacPayerName = (
  fullName: string | null | undefined,
  attendeeNames: readonly (string | null | undefined)[],
  email: string
): string => {
  const trimmed = (value: string | null | undefined): string => (typeof value === 'string' ? value.trim() : '');
  return trimmed(fullName) || attendeeNames.map(trimmed).find(Boolean) || email;
};
