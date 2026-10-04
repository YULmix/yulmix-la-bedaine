import fr from '../locales/fr.json';

// Shared option lists for registration fields.
// 'value' is the raw value persisted in Supabase (English/DB keys); 'label' is the French UI text.
// Centralizing these avoids raw DB values leaking untranslated into the UI.
//
// The domain types (#201) are the values the database's CHECK constraints allow; the generated
// database types only know these columns as text.

/** A choice in a list: the stored value and its French label. */
export interface Option<V extends string = string> {
  value: V;
  label: string;
}

// user_parties.status / payment_status enum values (English, matching events.status).
// See the CHECK constraints in supabase/migrations/ and docs/adr/0012-migrate-status-columns-to-english.md.
export const REGISTRATION_STATUS = {
  REGISTERED: 'registered',
  PENDING: 'pending',
  CANCELLED: 'cancelled'
} as const;

/** user_parties.status. */
export type PartyStatus = typeof REGISTRATION_STATUS[keyof typeof REGISTRATION_STATUS];

export const PAYMENT_STATUS = {
  PAID: 'paid',
  UNPAID: 'unpaid'
} as const;

/** user_parties.payment_status. */
export type PaymentStatus = typeof PAYMENT_STATUS[keyof typeof PAYMENT_STATUS];

export const EDITABLE_REGISTRATION_STATUSES: PartyStatus[] = [REGISTRATION_STATUS.REGISTERED, REGISTRATION_STATUS.PENDING];

// A cancelled registration keeps its row (cancellation is a soft status change, #35), so "has a
// row" is not "is registered". Screens treat a cancelled row as no registration: the member can
// register again, which reuses that row.
export const isActiveRegistration = (registration: { status?: string | null } | null | undefined): boolean =>
  !!registration && registration.status !== REGISTRATION_STATUS.CANCELLED;

const REGISTRATION_STATUS_LABELS: Record<string, string> = {
  [REGISTRATION_STATUS.REGISTERED]: fr.statusRegistered,
  [REGISTRATION_STATUS.PENDING]: fr.statusPending,
  [REGISTRATION_STATUS.CANCELLED]: fr.statusCancelled
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  [PAYMENT_STATUS.PAID]: fr.paid,
  [PAYMENT_STATUS.UNPAID]: fr.unpaid
};

// Short form for compact UI (admin toggle buttons, toasts) — 'unpaid' above is the
// longer "En attente de paiement" phrasing used on the member-facing summary badge.
const PAYMENT_STATUS_SHORT_LABELS: Record<string, string> = {
  [PAYMENT_STATUS.PAID]: fr.paid,
  [PAYMENT_STATUS.UNPAID]: fr.unpaidShort
};

// edition_roles.role (#217, ADR 0023): the per-edition roles, lowest first.
export const EDITION_ROLE_OPTIONS: ReadonlyArray<Option<'committee' | 'organiser'>> = [
  { value: 'committee', label: fr.editionRoleCommittee },
  { value: 'organiser', label: fr.editionRoleOrganiser }
];

/** What « Équipe » can give: an edition role, or admin (every edition). */
export const ACCESS_ROLE_OPTIONS: ReadonlyArray<Option<'committee' | 'organiser' | 'admin'>> = [
  ...EDITION_ROLE_OPTIONS,
  { value: 'admin', label: fr.editionRoleAdmin }
];

export const getRegistrationStatusLabel = (status: string): string => REGISTRATION_STATUS_LABELS[status] || status;
export const getEditionRoleLabel = (role: string): string => getOptionLabel(EDITION_ROLE_OPTIONS, role, role);

// The signed-in user's level on the active event (#260): the edition role, or 'admin' for an
// admin's account (roleOn in editionRoles.ts). Plain members have none.
export const getAccessLevelLabel = (level: string | null | undefined): string | null =>
  !level ? null : level === 'admin' ? fr.editionRoleAdmin : getEditionRoleLabel(level);
export const getPaymentStatusLabel = (status: string): string => PAYMENT_STATUS_LABELS[status] || status;
export const getPaymentStatusShortLabel = (status: string): string => PAYMENT_STATUS_SHORT_LABELS[status] || status;

/** attendees.type: an attendee's age band. */
export type AttendeeType = 'Adult' | 'Teenager' | 'Kid';
/** attendees.participation: how much of the weekend they attend (kids: the after-party). */
export type Participation = 'Whole' | 'Main' | 'After-Party';

const ATTENDEE_TYPE_LABELS: Record<string, string> = {
  Adult: fr.attendeeTypeAdult,
  Teenager: fr.attendeeTypeTeenager,
  Kid: fr.attendeeTypeKid
};

export const getAttendeeTypeLabel = (type: string): string => ATTENDEE_TYPE_LABELS[type] || type;
export const getParticipationSummaryLabel = (participation: string): string => participation === 'Whole' ? fr.participationWhole : fr.participationPartial;

export const TIER_OPTIONS = [
  { value: 'adult-whole', label: 'Adulte - Fin de semaine complète', type: 'Adult', participation: 'Whole' },
  { value: 'adult-main', label: 'Adulte - Événement principal', type: 'Adult', participation: 'Main' },
  { value: 'teen-whole', label: 'Ado - Fin de semaine complète', type: 'Teenager', participation: 'Whole' },
  { value: 'teen-main', label: 'Ado - Événement principal', type: 'Teenager', participation: 'Main' },
  { value: 'kid', label: 'Enfant', type: 'Kid', participation: 'After-Party' }
] as const satisfies ReadonlyArray<Option & { type: AttendeeType; participation: Participation }>;

/** The form's choice of type and participation in one (the glossary's tier). */
export type Tier = typeof TIER_OPTIONS[number]['value'];

export const ACCOMMODATION_OPTIONS = [
  { value: 'camping', label: fr.accommodationCamping },
  { value: 'floor', label: fr.accommodationFloor },
  { value: 'bed', label: fr.accommodationBed },
  { value: 'sofa', label: fr.accommodationSofa },
  { value: 'outside_other', label: fr.accommodationOutsideOther }
] as const satisfies ReadonlyArray<Option>;

/** attendees.sleeping_preference, and a place's type. */
export type SleepingPreference = typeof ACCOMMODATION_OPTIONS[number]['value'];

export const BED_REASON_OPTIONS = [
  { value: 'health', label: fr.bedReasonHealth },
  { value: 'children', label: fr.bedReasonChildren },
  { value: 'comfort', label: fr.bedReasonComfort },
  { value: 'other', label: fr.bedReasonOther }
] as const satisfies ReadonlyArray<Option>;

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
] as const satisfies ReadonlyArray<Option>;

// event_budgets.lines[].category values (#109), matching the check in enforce_event_budget().
export const BUDGET_CATEGORIES = [
  { value: 'Chalet', label: fr.eventExpenseCategoryChalet },
  { value: 'Food', label: fr.eventExpenseCategoryFood },
  { value: 'Music', label: fr.eventExpenseCategoryMusic },
  { value: 'Tech', label: fr.eventExpenseCategoryTech },
  { value: 'Accessories', label: fr.eventExpenseCategoryAccessories },
  { value: 'Other', label: fr.budgetCategoryOther }
] as const satisfies ReadonlyArray<Option>;

export const TRANSPORT_TYPES = [
  { value: 'offer', label: fr.transportTypeOffer },
  { value: 'need', label: fr.transportTypeNeed }
] as const satisfies ReadonlyArray<Option>;

/** A transport entry, as the transport column holds it (the fields read here). */
interface Transport {
  type?: string | null;
  departure_fsa?: string | null;
  departure_place?: string | null;
}

/** What a party said about transport, for admins. */
export type TransportKind = 'offer' | 'need' | 'none';

// What a party said about transport, for admins (#179): 'offer', 'need' or 'none'. A party with no
// transport is saved as type '' by the form, but the column default is 'None': both are 'none'.
export const transportKindOf = (transport: Transport | null | undefined): TransportKind =>
  (TRANSPORT_TYPES.some(option => option.value === transport?.type) ? transport!.type as TransportKind : 'none');

const TRANSPORT_KIND_LABELS: Record<TransportKind, string> = {
  offer: fr.transportKindOffer,
  need: fr.transportKindNeed,
  none: fr.transportKindNone
};

/** Where a lift leaves from (#181), for people: « H2G · métro Jean-Talon », either part alone, or ''. */
export const departureOf = (transport: Transport | null | undefined): string => [transport?.departure_fsa, (transport?.departure_place || '').trim()]
  .filter(Boolean)
  .join(' · ');

/** The short admin label of a transport kind (transportKindOf): « Offre », « Besoin », « Aucun ». */
export const getTransportKindLabel = (kind: TransportKind): string => TRANSPORT_KIND_LABELS[kind];

/** What a member reads about their own transport (#232): « Je me débrouille » when there is none. */
export const getTransportTypeLabel = (transport: Transport | null | undefined): string => {
  const kind = transportKindOf(transport);
  return kind === 'none' ? fr.transportTypeNone : getOptionLabel(TRANSPORT_TYPES, kind);
};

export const DIETARY_OPTIONS = [
  { value: 'none', label: fr.noDietaryNeeds },
  { value: 'vegetarian', label: fr.vegetarian },
  { value: 'vegan', label: fr.vegan },
  { value: 'gluten_free', label: fr.glutenFree },
  { value: 'dairy_free', label: fr.dairyFree },
  { value: 'other', label: fr.otherDietary }
] as const satisfies ReadonlyArray<Option>;

/** One of attendees.dietary_needs. */
export type DietaryNeed = typeof DIETARY_OPTIONS[number]['value'];

// An attendee's dietary needs (#153): an array of DIETARY_OPTIONS values, empty = not answered.
// 'none' only on its own, 'other' goes with dietary_other (the database enforces both).
// Older data (edit history, a stale row) may hold a single value: read it as a one-element array.
export const dietaryNeedsOf = (value: string[] | string | null | undefined): string[] => {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
};

const dietaryOrder = (values: string[]): string[] => DIETARY_OPTIONS.map(option => option.value).filter(value => values.includes(value));

// The selection after a chip toggle (`next` is the toggled array): choosing « Aucune restriction »
// clears the others, choosing anything else clears it. Kept in DIETARY_OPTIONS order.
export const nextDietaryNeeds = (previous: string[], next: string[]): string[] => {
  const added = next.filter(value => !previous.includes(value));
  if (added.includes('none')) return ['none'];
  return dietaryOrder(added.length ? next.filter(value => value !== 'none') : next);
};

// The French labels of an attendee's needs to show (not « Aucune restriction »), « Autre »
// replaced by what they wrote.
export const dietaryLabelsOf = (attendee: { dietary_needs?: string[] | string | null; dietary_other?: string | null }): string[] => dietaryNeedsOf(attendee.dietary_needs)
  .filter(value => value !== 'none')
  .map(value => (value === 'other' && attendee.dietary_other ? attendee.dietary_other : getOptionLabel(DIETARY_OPTIONS, value)));

// Generic label lookup: returns the French label for a raw DB value, or 'fallback' if not found/empty.
export const getOptionLabel = (options: ReadonlyArray<Option>, value: string | null | undefined, fallback = 'Non spécifié'): string => {
  if (!value) return fallback;
  const match = options.find(opt => opt.value === value);
  return match ? match.label : value;
};

// Kept for old history rows (#200): registration_edits snapshots taken before attendees (migration
// 20260929003000) still hold logistics.food_requests.requests, and editHistory.js renders them.
// Dietary requests were stored as a comma-joined string of raw DIETARY_OPTIONS values
// (e.g. 'vegetarian, gluten_free'). This translates each token to French before rejoining.
export const getDietaryRequestsLabel = (requestsString: string | null | undefined, fallback = 'Aucune'): string => {
  if (!requestsString) return fallback;
  return requestsString
    .split(',')
    .map(v => v.trim())
    .filter(Boolean)
    .map(v => getOptionLabel(DIETARY_OPTIONS, v, v))
    .join(', ');
};
// Transactional emails (email_log, #12 / #93). template and status are raw DB values.
const EMAIL_TEMPLATE_LABELS: Record<string, string> = {
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
} as const;

export type EmailStatus = typeof EMAIL_STATUS[keyof typeof EMAIL_STATUS];

// The ones an organiser has to follow up by hand: refused by Resend, or claimed and never finished.
export const EMAIL_PROBLEM_STATUSES: EmailStatus[] = [EMAIL_STATUS.FAILED, EMAIL_STATUS.PENDING];

const EMAIL_STATUS_LABELS: Record<string, string> = {
  [EMAIL_STATUS.SENT]: fr.emailStatusSent,
  [EMAIL_STATUS.FAILED]: fr.emailStatusFailed,
  [EMAIL_STATUS.PENDING]: fr.emailStatusPending,
  [EMAIL_STATUS.DRY_RUN]: fr.emailStatusDryRun,
  [EMAIL_STATUS.BACKFILLED]: fr.emailStatusBackfilled,
  [EMAIL_STATUS.NOT_SENT]: fr.emailStatusNotSent
};

const EMAIL_STATUS_TONES: Record<string, string> = {
  [EMAIL_STATUS.SENT]: 'ok',
  [EMAIL_STATUS.FAILED]: 'bad',
  [EMAIL_STATUS.PENDING]: 'warn',
  [EMAIL_STATUS.NOT_SENT]: 'bad'
};

export const getEmailTemplateLabel = (template: string): string => EMAIL_TEMPLATE_LABELS[template] || template;
export const getEmailStatusLabel = (status: string): string => EMAIL_STATUS_LABELS[status] || status;
export const getEmailStatusTone = (status: string): string => EMAIL_STATUS_TONES[status] || 'neutral';
