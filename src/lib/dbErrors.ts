import fr from '../locales/fr.json';
import { formatDate } from './format';

/** A code's parameters, from the error's `details` (JSON). */
type ErrorParams = Record<string, string | number | null | undefined>;

// The database raises errors as stable English codes (the error's `message`), with their
// parameters as JSON in `details`: no user-facing text lives in SQL. This maps each code to its
// French text. Add a code here, with its fr.json key, whenever a migration raises a new one.
const DB_ERRORS: Record<string, (params: ErrorParams) => string> = {
  not_authenticated: () => fr.dbErrorNotAuthenticated,
  root_admin_cannot_be_deleted: () => fr.dbErrorRootAdminCannotBeDeleted,
  account_deletion_locked: ({ event, close_date: closeDate }) => fr.dbErrorAccountDeletionLocked
    .replace('{event}', String(event ?? ''))
    .replace('{date}', formatDate(closeDate as string | null)),
  place_assignment_party_inactive: () => fr.dbErrorPlaceAssignmentPartyInactive,
  admin_only: () => fr.dbErrorAdminOnly,
  logistics_party_not_found: () => fr.dbErrorLogisticsPartyNotFound,
  logistics_attendee_not_in_party: () => fr.dbErrorLogisticsAttendeeNotInParty,
  logistics_changes_invalid: () => fr.dbErrorLogisticsChangesInvalid,
  place_assignment_wrong_event: () => fr.dbErrorPlaceAssignmentWrongEvent,
  place_assignment_place_excluded: () => fr.dbErrorPlaceAssignmentPlaceExcluded,
  place_assignment_attendee_removed: () => fr.dbErrorPlaceAssignmentAttendeeRemoved,
  place_exclusion_occupied: () => fr.dbErrorPlaceExclusionOccupied,
  place_override_wrong_venue: () => fr.dbErrorPlaceOverrideWrongVenue,
  place_venue_fixed: () => fr.dbErrorPlaceVenueFixed,
  venue_layout_frozen: () => fr.dbErrorVenueLayoutFrozen,
  event_layout_frozen: () => fr.dbErrorEventLayoutFrozen,
  event_reg_start_not_before_event_start: () => fr.dbErrorEventRegStartNotBeforeEventStart,
  event_not_found: () => fr.dbErrorEventNotFound,
  event_deletion_forbidden: () => fr.dbErrorEventDeletionForbidden,
  event_budget_lines_invalid: () => fr.dbErrorEventBudgetInvalid,
  event_budget_line_invalid: () => fr.dbErrorEventBudgetInvalid,
  event_budget_payer_invalid: () => fr.dbErrorEventBudgetPayerInvalid,
  own_admin_status_unchangeable: () => fr.selfAdminToggleError,
  self_admin_promotion_forbidden: () => fr.dbErrorSelfAdminPromotionForbidden,
  root_admin_cannot_be_demoted: () => fr.dbErrorRootAdminCannotBeDemoted,
  attendees_required: () => fr.dbErrorAttendeesRequired,
  attendees_write_through_save_registration: () => fr.dbErrorAttendeesWriteThroughSaveRegistration,
  registration_cancel_locked: ({ close_date: closeDate }) => fr.cancelRegistrationLocked
    .replace('{date}', formatDate(closeDate as string | null)),
  carpool_board_forbidden: () => fr.dbErrorCarpoolBoardForbidden,
  gallery_full: ({ max }) => fr.dbErrorGalleryFull.replace('{max}', String(max ?? 30)),
  event_already_active: () => fr.eventAlreadyActiveError,
  place_in_use: () => fr.placeOccupiedUnseen,
  registration_attendee_removal_locked: ({ close_date: closeDate }) => fr.dbErrorAttendeeRemovalLocked
    .replace('{date}', formatDate(closeDate as string | null)),
  // Edition roles (#217, ADR 0023).
  committee_only: () => fr.dbErrorCommitteeOnly,
  organiser_only: () => fr.dbErrorOrganiserOnly,
  party_not_found: () => fr.dbErrorLogisticsPartyNotFound,
  payment_status_invalid: () => fr.dbErrorPaymentStatusInvalid,
  edition_role_invalid: () => fr.dbErrorEditionRoleInvalid,
  edition_role_target_admin: () => fr.dbErrorEditionRoleTargetAdmin,
  edition_role_target_deleted: () => fr.dbErrorEditionRoleTargetDeleted,
  edition_role_target_not_found: () => fr.dbErrorEditionRoleTargetNotFound,
  // « Voir comme » (#265, ADR 0025).
  read_only_impersonation: () => fr.dbErrorReadOnlyImpersonation,
  impersonation_actor_not_admin: () => fr.dbErrorImpersonationActorNotAdmin,
  impersonation_target_self: () => fr.dbErrorImpersonationTargetSelf,
  impersonation_target_admin: () => fr.dbErrorImpersonationTargetAdmin,
  impersonation_target_deleted: () => fr.dbErrorImpersonationTargetDeleted,
  impersonation_target_not_found: () => fr.dbErrorImpersonationTargetNotFound,
  impersonation_target_pending: () => fr.dbErrorImpersonationTargetPending,
  impersonation_log_immutable: () => fr.dbErrorImpersonationLogImmutable
};

const parseDetails = (details: string | null | undefined): ErrorParams => {
  try {
    const parsed = JSON.parse(details ?? '');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

/**
 * An error the app raises itself, whose message is already French (from fr.json):
 * dbErrorMessage shows it as is.
 * @param {string} message
 * @returns {Error}
 */
export const appError = (message: string): Error & { isAppMessage: true } => Object.assign(new Error(message), { isAppMessage: true as const });

/**
 * The French message for a Supabase/PostgREST error raised by our own SQL, or for an appError.
 * Never returns the raw database message: an unknown error gets `fallback`.
 * @param {{ message?: string, details?: string } | null | undefined} error
 * @param {string} fallback
 * @returns {string}
 */
/** What dbErrorMessage reads of an error: a PostgREST error, an appError, or nothing. */
export interface ErrorLike {
  message?: string;
  details?: string | null;
  isAppMessage?: boolean;
}

export const dbErrorMessage = (error: ErrorLike | null | undefined, fallback: string): string => {
  if (error?.isAppMessage) return error.message ?? fallback;
  const format = error?.message && Object.hasOwn(DB_ERRORS, error.message) ? DB_ERRORS[error.message] : null;
  return format ? format(parseDetails(error?.details)) : fallback;
};
