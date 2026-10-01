// The start of a Canadian postal code, the forward sortation area (FSA, e.g. « H2G »): where a
// lift leaves from (#181). About a neighbourhood: enough to match lifts by distance (#180)
// without storing anyone's address. Same rule as the user_parties_transport_departure_fsa CHECK.

// Letter, digit, letter. D, F, I, O, Q and U are never used; W and Z never come first.
export const FSA_PATTERN = /^[ABCEGHJ-NPRSTVXY][0-9][ABCEGHJ-NPRSTV-Z]$/;

/** What was typed, as an FSA candidate: upper case, spaces and dashes dropped, first three characters (a full postal code works). */
export const normalizeFsa = (text) => (text || '').toUpperCase().replace(/[\s-]/g, '').slice(0, 3);

/** True for a well-formed FSA, e.g. « H2G ». */
export const isValidFsa = (fsa) => FSA_PATTERN.test(fsa || '');
