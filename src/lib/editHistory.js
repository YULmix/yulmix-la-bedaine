import fr from '../locales/fr.json';
import { formatCurrency } from './format.js';
import {
  ACCOMMODATION_OPTIONS,
  TRANSPORT_TYPES,
  departureOf,
  getOptionLabel,
  getDietaryRequestsLabel,
  getRegistrationStatusLabel,
  getPaymentStatusLabel
} from './registrationOptions';

// Turns one registration_edits.changes JSON ({ field: { old, new } }) into readable French
// lines, for the member's "Historique des modifications" and the admin « Historique des
// changements » (#173). A creation entry is { created: { old: null, new: { attendees, status,
// is_waitlisted, calculated_amount_owed } } }: one line with no old value.

const FIELD_LABEL_KEYS = {
  created: 'historyFieldCreated',
  attendees: 'historyFieldAttendees',
  counts: 'historyFieldCounts',
  logistics: 'inputSummary',
  transport: 'transport',
  music_requests: 'musicRequests',
  message_to_organizers: 'messageToOrganizers',
  confirmation_message: 'historyFieldConfirmation',
  status: 'status',
  calculated_amount_owed: 'amountDue',
  payment_status: 'paymentStatus',
  is_waitlisted: 'eventHistoryTableWaitlisted',
  admin_notes: 'historyFieldAdminNotes'
};

const headCount = (attendees) =>
  (attendees.length === 1 ? fr.countPersonOne : fr.countPersonOther).replace('{count}', attendees.length);

/** « 2 personnes · Inscrit · 520,00 $ »: what the registration started as. */
const describeCreation = (created) => [
  Array.isArray(created.attendees) && headCount(created.attendees),
  created.is_waitlisted ? fr.filterWaitlist : created.status && getRegistrationStatusLabel(created.status),
  created.calculated_amount_owed != null && formatCurrency(Number(created.calculated_amount_owed) || 0)
].filter(Boolean).join(' · ');

const formatValue = (field, value) => {
  if (field === 'created') return value && typeof value === 'object' ? describeCreation(value) : '';
  if (value === null || value === undefined || value === '') return fr.historyEmptyValue;
  switch (field) {
    case 'calculated_amount_owed':
      return formatCurrency(Number(value) || 0);
    case 'attendees':
      return Array.isArray(value) ? headCount(value) : JSON.stringify(value);
    case 'counts':
      if (typeof value === 'object') {
        return fr.historyCountsValue
          .replace('{aw}', value.adult_whole || 0)
          .replace('{am}', value.adult_main || 0)
          .replace('{tw}', value.teen_whole || 0)
          .replace('{tm}', value.teen_main || 0)
          .replace('{k}', value.kids || 0);
      }
      return JSON.stringify(value);
    case 'logistics':
      if (typeof value === 'object') {
        const parts = [];
        if (value.sleeping?.pref) parts.push(`${fr.accommodation}: ${getOptionLabel(ACCOMMODATION_OPTIONS, value.sleeping.pref, value.sleeping.pref)}`);
        if (value.food_requests?.requests) parts.push(`${fr.dietaryNeeds}: ${getDietaryRequestsLabel(value.food_requests.requests)}`);
        if (value.volunteering?.length > 0) parts.push(`${fr.volunteering}: ${value.volunteering.length}`);
        return parts.join(', ') || fr.historyNoInfo;
      }
      return JSON.stringify(value);
    case 'transport':
      if (typeof value === 'object') {
        const place = departureOf(value) ? `, ${fr.transportDeparturePlaceShort}: ${departureOf(value)}` : '';
        return `${getOptionLabel(TRANSPORT_TYPES, value.type, fr.noneFallback)}, ${fr.transportSeats}: ${value.seats || 0}${place}`;
      }
      return JSON.stringify(value);
    case 'status':
      return getRegistrationStatusLabel(value);
    case 'payment_status':
      return getPaymentStatusLabel(value);
    case 'is_waitlisted':
      return value ? fr.userProfileYes : fr.userProfileNo;
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
};

/**
 * One line per changed field. `from` is '' on a creation line, which has no old value.
 * @returns {Array<{label: string, from: string, to: string}>}
 */
export const describeChanges = (changes) => {
  if (!changes || typeof changes !== 'object') return [];
  return Object.entries(changes)
    .filter(([, data]) => data && typeof data === 'object' && 'old' in data && 'new' in data)
    .map(([field, data]) => ({
      label: fr[FIELD_LABEL_KEYS[field]] || field.replace(/_/g, ' '),
      from: formatValue(field, data.old),
      to: formatValue(field, data.new)
    }));
};
