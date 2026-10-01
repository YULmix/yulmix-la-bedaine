import fr from '../locales/fr.json';

// Shared option lists for registration fields.
// 'value' is the raw value persisted in Supabase (English/DB keys); 'label' is the French UI text.
// Centralizing these avoids raw DB values leaking untranslated into the UI.

// user_parties.status / payment_status enum values (English, matching events.status).
// See the CHECK constraints in supabase/migrations/ and docs/adr/0012-migrate-status-columns-to-english.md.
export const REGISTRATION_STATUS = {
  REGISTERED: 'registered',
  PENDING: 'pending',
  CANCELLED: 'cancelled'
};

export const PAYMENT_STATUS = {
  PAID: 'paid',
  UNPAID: 'unpaid'
};

export const EDITABLE_REGISTRATION_STATUSES = [REGISTRATION_STATUS.REGISTERED, REGISTRATION_STATUS.PENDING];

// A cancelled registration keeps its row (cancellation is a soft status change, #35), so "has a
// row" is not "is registered". Screens treat a cancelled row as no registration: the member can
// register again, which reuses that row.
export const isActiveRegistration = (registration) =>
  !!registration && registration.status !== REGISTRATION_STATUS.CANCELLED;

const REGISTRATION_STATUS_LABELS = {
  [REGISTRATION_STATUS.REGISTERED]: fr.statusRegistered,
  [REGISTRATION_STATUS.PENDING]: fr.statusPending,
  [REGISTRATION_STATUS.CANCELLED]: fr.statusCancelled
};

const PAYMENT_STATUS_LABELS = {
  [PAYMENT_STATUS.PAID]: fr.paid,
  [PAYMENT_STATUS.UNPAID]: fr.unpaid
};

// Short form for compact UI (admin toggle buttons, toasts) — 'unpaid' above is the
// longer "En attente de paiement" phrasing used on the member-facing summary badge.
const PAYMENT_STATUS_SHORT_LABELS = {
  [PAYMENT_STATUS.PAID]: fr.paid,
  [PAYMENT_STATUS.UNPAID]: fr.unpaidShort
};

export const getRegistrationStatusLabel = (status) => REGISTRATION_STATUS_LABELS[status] || status;
export const getPaymentStatusLabel = (status) => PAYMENT_STATUS_LABELS[status] || status;
export const getPaymentStatusShortLabel = (status) => PAYMENT_STATUS_SHORT_LABELS[status] || status;

const ATTENDEE_TYPE_LABELS = {
  Adult: fr.attendeeTypeAdult,
  Teenager: fr.attendeeTypeTeenager,
  Kid: fr.attendeeTypeKid
};

export const getAttendeeTypeLabel = (type) => ATTENDEE_TYPE_LABELS[type] || type;
export const getParticipationSummaryLabel = (participation) => participation === 'Whole' ? fr.participationWhole : fr.participationPartial;

export const TIER_OPTIONS = [
  { value: 'adult-whole', label: 'Adulte - Fin de semaine complète', type: 'Adult', participation: 'Whole' },
  { value: 'adult-main', label: 'Adulte - Événement principal', type: 'Adult', participation: 'Main' },
  { value: 'teen-whole', label: 'Ado - Fin de semaine complète', type: 'Teenager', participation: 'Whole' },
  { value: 'teen-main', label: 'Ado - Événement principal', type: 'Teenager', participation: 'Main' },
  { value: 'kid', label: 'Enfant', type: 'Kid', participation: 'After-Party' }
];

export const ACCOMMODATION_OPTIONS = [
  { value: 'camping', label: fr.accommodationCamping },
  { value: 'floor', label: fr.accommodationFloor },
  { value: 'bed', label: fr.accommodationBed },
  { value: 'sofa', label: fr.accommodationSofa },
  { value: 'outside_other', label: fr.accommodationOutsideOther }
];

export const BED_REASON_OPTIONS = [
  { value: 'health', label: fr.bedReasonHealth },
  { value: 'children', label: fr.bedReasonChildren },
  { value: 'comfort', label: fr.bedReasonComfort },
  { value: 'other', label: fr.bedReasonOther }
];

export const VOLUNTEERING_OPTIONS = [
  { value: 'food_purchase', label: fr.volunteeringFoodPurchase },
  { value: 'cook_meal', label: fr.volunteeringCookMeal },
  { value: 'dj_afternoon', label: fr.volunteeringDJAfternoon },
  { value: 'dj_evening', label: fr.volunteeringDJEvening },
  { value: 'setup_friday', label: fr.volunteeringSetupFriday },
  { value: 'cleanup_sunday', label: fr.volunteeringCleanupSunday },
  { value: 'neighbor_management', label: fr.volunteeringNeighborManagement },
  { value: 'parking', label: fr.volunteeringParking },
  { value: 'art_initiative', label: fr.volunteeringArtInitiative },
  { value: 'pharmacy', label: fr.volunteeringPharmacy },
  { value: 'other', label: fr.volunteeringOther }
];

// event_budgets.lines[].category values (#109), matching the check in enforce_event_budget().
export const BUDGET_CATEGORIES = [
  { value: 'Chalet', label: fr.eventExpenseCategoryChalet },
  { value: 'Food', label: fr.eventExpenseCategoryFood },
  { value: 'Music', label: fr.eventExpenseCategoryMusic },
  { value: 'Tech', label: fr.eventExpenseCategoryTech },
  { value: 'Accessories', label: fr.eventExpenseCategoryAccessories },
  { value: 'Other', label: fr.budgetCategoryOther }
];

export const TRANSPORT_TYPES = [
  { value: 'offer', label: fr.transportTypeOffer },
  { value: 'need', label: fr.transportTypeNeed }
];

// What a party said about transport, for admins (#179): 'offer', 'need' or 'none'. A party with no
// transport is saved as type '' by the form, but the column default is 'None': both are 'none'.
export const transportKindOf = (transport) =>
  (TRANSPORT_TYPES.some(option => option.value === transport?.type) ? transport.type : 'none');

const TRANSPORT_KIND_LABELS = {
  offer: fr.transportKindOffer,
  need: fr.transportKindNeed,
  none: fr.transportKindNone
};

/** The short admin label of a transport kind (transportKindOf): « Offre », « Besoin », « Aucun ». */
export const getTransportKindLabel = (kind) => TRANSPORT_KIND_LABELS[kind];

export const DIETARY_OPTIONS = [
  { value: 'none', label: fr.noDietaryNeeds },
  { value: 'vegetarian', label: fr.vegetarian },
  { value: 'vegan', label: fr.vegan },
  { value: 'gluten_free', label: fr.glutenFree },
  { value: 'dairy_free', label: fr.dairyFree },
  { value: 'other', label: fr.otherDietary }
];

// An attendee's dietary needs (#153): an array of DIETARY_OPTIONS values, empty = not answered.
// 'none' only on its own, 'other' goes with dietary_other (the database enforces both).
// Older data (edit history, a stale row) may hold a single value: read it as a one-element array.
export const dietaryNeedsOf = (value) => {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
};

const dietaryOrder = (values) => DIETARY_OPTIONS.map(option => option.value).filter(value => values.includes(value));

// The selection after a chip toggle (`next` is the toggled array): choosing « Aucune restriction »
// clears the others, choosing anything else clears it. Kept in DIETARY_OPTIONS order.
export const nextDietaryNeeds = (previous, next) => {
  const added = next.filter(value => !previous.includes(value));
  if (added.includes('none')) return ['none'];
  return dietaryOrder(added.length ? next.filter(value => value !== 'none') : next);
};

// The French labels of an attendee's needs to show (not « Aucune restriction »), « Autre »
// replaced by what they wrote.
export const dietaryLabelsOf = (attendee) => dietaryNeedsOf(attendee.dietary_needs)
  .filter(value => value !== 'none')
  .map(value => (value === 'other' && attendee.dietary_other ? attendee.dietary_other : getOptionLabel(DIETARY_OPTIONS, value)));

// Generic label lookup: returns the French label for a raw DB value, or 'fallback' if not found/empty.
export const getOptionLabel = (options, value, fallback = 'Non spécifié') => {
  if (!value) return fallback;
  const match = options.find(opt => opt.value === value);
  return match ? match.label : value;
};

// Dietary requests are stored as a comma-joined string of raw DIETARY_OPTIONS values
// (e.g. 'vegetarian, gluten_free'). This translates each token to French before rejoining.
export const getDietaryRequestsLabel = (requestsString, fallback = 'Aucune') => {
  if (!requestsString) return fallback;
  return requestsString
    .split(',')
    .map(v => v.trim())
    .filter(Boolean)
    .map(v => getOptionLabel(DIETARY_OPTIONS, v, v))
    .join(', ');
};
// Transactional emails (email_log, #12 / #93). template and status are raw DB values.
const EMAIL_TEMPLATE_LABELS = {
  registration: fr.emailTemplateRegistration,
  waitlist: fr.emailTemplateWaitlist,
  promotion: fr.emailTemplatePromotion,
  payment: fr.emailTemplatePayment,
  accommodation: fr.emailTemplateAccommodation
};

// Every email_log.status (admins), plus 'not_sent', the member-facing status my_party_emails()
// returns for a failed send.
export const EMAIL_STATUS = {
  SENT: 'sent',
  FAILED: 'failed',
  PENDING: 'pending',
  DRY_RUN: 'dry_run',
  BACKFILLED: 'backfilled',
  NOT_SENT: 'not_sent'
};

// The ones an organiser has to follow up by hand: refused by Resend, or claimed and never finished.
export const EMAIL_PROBLEM_STATUSES = [EMAIL_STATUS.FAILED, EMAIL_STATUS.PENDING];

const EMAIL_STATUS_LABELS = {
  [EMAIL_STATUS.SENT]: fr.emailStatusSent,
  [EMAIL_STATUS.FAILED]: fr.emailStatusFailed,
  [EMAIL_STATUS.PENDING]: fr.emailStatusPending,
  [EMAIL_STATUS.DRY_RUN]: fr.emailStatusDryRun,
  [EMAIL_STATUS.BACKFILLED]: fr.emailStatusBackfilled,
  [EMAIL_STATUS.NOT_SENT]: fr.emailStatusNotSent
};

const EMAIL_STATUS_TONES = {
  [EMAIL_STATUS.SENT]: 'ok',
  [EMAIL_STATUS.FAILED]: 'bad',
  [EMAIL_STATUS.PENDING]: 'warn',
  [EMAIL_STATUS.NOT_SENT]: 'bad'
};

export const getEmailTemplateLabel = (template) => EMAIL_TEMPLATE_LABELS[template] || template;
export const getEmailStatusLabel = (status) => EMAIL_STATUS_LABELS[status] || status;
export const getEmailStatusTone = (status) => EMAIL_STATUS_TONES[status] || 'neutral';
