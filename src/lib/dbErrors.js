import fr from '../locales/fr.json';
import { formatDate } from './format.js';

// The database raises errors as stable English codes (the error's `message`), with their
// parameters as JSON in `details`: no user-facing text lives in SQL. This maps each code to its
// French text. Add a code here, with its fr.json key, whenever a migration raises a new one.
const DB_ERRORS = {
  not_authenticated: () => fr.dbErrorNotAuthenticated,
  root_admin_cannot_be_deleted: () => fr.dbErrorRootAdminCannotBeDeleted,
  account_deletion_locked: ({ event, close_date: closeDate }) => fr.dbErrorAccountDeletionLocked
    .replace('{event}', event ?? '')
    .replace('{date}', formatDate(closeDate)),
  place_assignment_party_inactive: () => fr.dbErrorPlaceAssignmentPartyInactive,
  admin_only: () => fr.dbErrorAdminOnly,
  logistics_party_not_found: () => fr.dbErrorLogisticsPartyNotFound,
  logistics_attendee_not_in_party: () => fr.dbErrorLogisticsAttendeeNotInParty,
  logistics_changes_invalid: () => fr.dbErrorLogisticsChangesInvalid,
  place_assignment_wrong_event: () => fr.dbErrorPlaceAssignmentWrongEvent,
  place_assignment_place_excluded: () => fr.dbErrorPlaceAssignmentPlaceExcluded,
  place_exclusion_occupied: () => fr.dbErrorPlaceExclusionOccupied,
  place_override_wrong_venue: () => fr.dbErrorPlaceOverrideWrongVenue,
  place_venue_fixed: () => fr.dbErrorPlaceVenueFixed,
  venue_layout_frozen: () => fr.dbErrorVenueLayoutFrozen,
  event_layout_frozen: () => fr.dbErrorEventLayoutFrozen,
  event_reg_start_not_before_event_start: () => fr.dbErrorEventRegStartNotBeforeEventStart
};

const parseDetails = (details) => {
  try {
    const parsed = JSON.parse(details);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

/**
 * The French message for a Supabase/PostgREST error raised by our own SQL.
 * Never returns the raw database message: an unknown error gets `fallback`.
 * @param {{ message?: string, details?: string } | null | undefined} error
 * @param {string} fallback
 * @returns {string}
 */
export const dbErrorMessage = (error, fallback) => {
  const format = error?.message && Object.hasOwn(DB_ERRORS, error.message) ? DB_ERRORS[error.message] : null;
  return format ? format(parseDetails(error.details)) : fallback;
};
