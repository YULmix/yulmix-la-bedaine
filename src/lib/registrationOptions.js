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
  { value: 'sofa', label: fr.accommodationSofa }
];

export const BED_REASON_OPTIONS = [
  { value: 'health', label: fr.bedReasonHealth },
  { value: 'children', label: fr.bedReasonChildren },
  { value: 'comfort', label: fr.bedReasonComfort }
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

export const TRANSPORT_TYPES = [
  { value: 'offer', label: fr.transportTypeOffer },
  { value: 'need', label: fr.transportTypeNeed }
];

export const DIETARY_OPTIONS = [
  { value: 'none', label: fr.noDietaryNeeds },
  { value: 'vegetarian', label: fr.vegetarian },
  { value: 'vegan', label: fr.vegan },
  { value: 'gluten_free', label: fr.glutenFree },
  { value: 'other', label: fr.otherDietary }
];

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