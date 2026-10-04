import fr from '../locales/fr.json';
import { contactNameOf, tierCountsOf } from './adminStats.js';
import { formatDateTime } from './format.js';
import {
  ACCOMMODATION_OPTIONS,
  DIETARY_OPTIONS,
  VOLUNTEERING_OPTIONS,
  dietaryNeedsOf,
  getAttendeeTypeLabel,
  getOptionLabel,
  getParticipationSummaryLabel,
  getPaymentStatusShortLabel,
  getRegistrationStatusLabel,
  getTransportKindLabel,
  isActiveRegistration,
  transportKindOf
} from './registrationOptions';

// The admin data export (#178): two tables, « Par groupe » (one row per party) and « Par
// participant » (one row per attendee), each built once as { headers, rows } and serialised as a
// CSV download or a Google Sheets paste. Cells are strings or numbers, never raw database values.

/** « Inscrit », « En attente » or « Liste d'attente ». */
const statusOf = (party) => (party.is_waitlisted ? fr.filterWaitlist : getRegistrationStatusLabel(party.status));

/** The party's volunteering labels in VOLUNTEERING_OPTIONS order, its own text in place of « Autre ». */
const volunteeringOf = (party) => {
  const chosen = party.logistics?.volunteering || [];
  const other = (party.logistics?.volunteering_other || '').trim();
  return VOLUNTEERING_OPTIONS
    .filter(({ value }) => chosen.includes(value))
    .map(({ value, label }) => (value === 'other' && other ? other : label))
    .join(', ');
};

/** Seats offered, or needed (a need saved without a count needs a seat per attendee); '' with no lift. */
const seatsOf = (party) => {
  const kind = transportKindOf(party.transport);
  if (kind === 'none') return '';
  return Number(party.transport.seats) || (kind === 'need' ? (party.attendees || []).length : '');
};

const sleepingPreferenceOf = (attendee) => {
  const label = getOptionLabel(ACCOMMODATION_OPTIONS, attendee.sleeping_preference, '');
  const other = (attendee.sleeping_preference_other || '').trim();
  return label && other ? `${label} (${other})` : label;
};

const exportedParties = (parties) => parties.filter(isActiveRegistration);

/**
 * « Par groupe »: one row per non-cancelled party, then a totals row over the parties that aren't
 * waitlisted.
 * @returns {{ headers: string[], rows: Array<Array<string|number>> }}
 */
export const partyExportRows = (allParties) => {
  const parties = exportedParties(allParties);
  const headers = [
    fr.exportPartyName,
    fr.exportEmail,
    fr.exportStatus,
    fr.exportAdultWhole,
    fr.exportAdultMain,
    fr.exportTeenWhole,
    fr.exportTeenMain,
    fr.exportKids,
    fr.exportSleepingPref,
    fr.exportSleepingAssigned,
    fr.exportPaymentStatus,
    fr.exportAmountOwed,
    fr.exportTransportType,
    fr.exportTransportSeats,
    fr.exportArrival,
    fr.exportDeparture,
    fr.exportDepartureFsa,
    fr.exportDeparturePlace,
    fr.exportVolunteering,
    fr.exportMusicRequests,
    fr.exportMessageToOrganizers
  ];

  const rows = parties.map(party => {
    const counts = tierCountsOf(party.attendees);
    const attendees = party.attendees || [];
    return [
      party.profiles?.full_name || '',
      party.profiles?.email || '',
      statusOf(party),
      counts.adult_whole,
      counts.adult_main,
      counts.teen_whole,
      counts.teen_main,
      counts.kids,
      attendees.map(a => getOptionLabel(ACCOMMODATION_OPTIONS, a.sleeping_preference, '')).filter(Boolean).join('; '),
      attendees.filter(a => a.place).map(a => `${a.name || '?'}: ${a.place.bed_label}`).join('; '),
      getPaymentStatusShortLabel(party.payment_status),
      Number(party.calculated_amount_owed) || 0,
      getTransportKindLabel(transportKindOf(party.transport)),
      seatsOf(party),
      formatDateTime(party.transport?.arrival),
      formatDateTime(party.transport?.departure),
      transportKindOf(party.transport) === 'none' ? '' : (party.transport.departure_fsa || ''),
      transportKindOf(party.transport) === 'none' ? '' : (party.transport.departure_place || '').trim(),
      volunteeringOf(party),
      party.music_requests || '',
      party.message_to_organizers || ''
    ];
  });

  const counted = parties.filter(party => !party.is_waitlisted);
  const totals = counted.map(party => tierCountsOf(party.attendees)).reduce(
    (sum, counts) => Object.fromEntries(Object.keys(counts).map(tier => [tier, (sum[tier] || 0) + counts[tier]])),
    {}
  );
  const owed = counted.reduce((sum, party) => sum + (Number(party.calculated_amount_owed) || 0), 0);
  rows.push([
    fr.exportTotals, '', '',
    totals.adult_whole || 0, totals.adult_main || 0, totals.teen_whole || 0, totals.teen_main || 0, totals.kids || 0,
    '', '', '', owed,
    '', '', '', '', '', '', '', '', ''
  ]);

  return { headers, rows };
};

/**
 * The attendees of every non-cancelled party (waitlisted included), in party then attendee order,
 * with values as labels: the one source of « which attendees, which values » for the export and
 * the Inscrits « Participants » view (#262). The free-text fields stay apart from the labels.
 * @returns {Array<{ key: string, partyId: string, name: string, contact: string, type: string,
 *   participation: string, dietary: string[], dietaryOther: string, sleeping: string,
 *   sleepingOther: string, bed: string, status: string, waitlisted: boolean, firstTime: boolean }>}
 */
export const attendeeRows = (allParties) => exportedParties(allParties).flatMap(party => (party.attendees || []).map((attendee, index) => ({
  key: attendee.id || `${party.id}-${index}`,
  partyId: party.id,
  name: attendee.name || '',
  contact: contactNameOf(party),
  type: getAttendeeTypeLabel(attendee.type),
  participation: attendee.type === 'Kid' ? '' : getParticipationSummaryLabel(attendee.participation),
  dietary: dietaryNeedsOf(attendee.dietary_needs)
    .filter(value => value !== 'none')
    .map(value => getOptionLabel(DIETARY_OPTIONS, value)),
  dietaryOther: (attendee.dietary_other || '').trim(),
  sleeping: getOptionLabel(ACCOMMODATION_OPTIONS, attendee.sleeping_preference, ''),
  sleepingOther: (attendee.sleeping_preference_other || '').trim(),
  bed: attendee.place?.bed_label || '',
  status: statusOf(party),
  waitlisted: !!party.is_waitlisted,
  firstTime: !!attendee.is_new_member
})));

/**
 * « Par participant »: one row per attendee of every non-cancelled party, in party then attendee
 * order. No money, no totals.
 * @returns {{ headers: string[], rows: Array<Array<string|number>> }}
 */
export const attendeeExportRows = (allParties) => {
  const headers = [
    fr.exportAttendeeName,
    fr.exportPartyContact,
    fr.exportAttendeeType,
    fr.exportParticipation,
    fr.exportDietaryNeeds,
    fr.exportDietaryOther,
    fr.exportSleepingPref,
    fr.exportSleepingAssigned,
    fr.exportStatus,
    fr.firstTimeTag
  ];

  const rows = attendeeRows(allParties).map(row => [
    row.name,
    row.contact,
    row.type,
    row.participation,
    row.dietary.join(', '),
    row.dietaryOther,
    row.sleeping && row.sleepingOther ? `${row.sleeping} (${row.sleepingOther})` : row.sleeping,
    row.bed,
    row.status,
    row.firstTime ? fr.exportYes : ''
  ]);

  return { headers, rows };
};

/**
 * Sorts the view's rows (a copy). By name, or by group (the contact's name, then the order
 * entered); « grouped » keeps a party's attendees together under their contact, whatever the key:
 * groups by contact name, inside a group by name if that is the sort, else as entered.
 */
export const sortAttendees = (rows, { key = 'group', grouped = false } = {}) => {
  const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
  const indexed = rows.map((row, index) => ({ row, index }));
  const byName = (x, y) => collator.compare(x.row.name, y.row.name) || x.index - y.index;
  const byGroup = (x, y) => collator.compare(x.row.contact, y.row.contact) || x.index - y.index;
  if (grouped) {
    const inside = key === 'name' ? byName : (x, y) => x.index - y.index;
    return indexed.sort((x, y) => collator.compare(x.row.contact, y.row.contact) || (x.row.partyId === y.row.partyId ? 0 : x.row.partyId < y.row.partyId ? -1 : 1) || inside(x, y)).map(({ row }) => row);
  }
  return indexed.sort(key === 'name' ? byName : byGroup).map(({ row }) => row);
};

export const PARTY_EXPORT = 'parties';
export const ATTENDEE_EXPORT = 'attendees';

/** The two exports, in the order the Exporter dialog offers them. */
export const EXPORTS = [
  { id: PARTY_EXPORT, labelKey: 'exportByParty', filePrefix: 'inscriptions', build: partyExportRows },
  { id: ATTENDEE_EXPORT, labelKey: 'exportByAttendee', filePrefix: 'participants', build: attendeeExportRows }
];

/** Byte order mark: Excel and Numbers read a CSV as UTF-8, accents included, only with it. */
export const CSV_BOM = '﻿';

const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

/** A CSV with a BOM, every cell quoted, `"` doubled; line breaks stay inside their quoted cell. */
export const toCsv = ({ headers, rows }) =>
  CSV_BOM + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');

const tsvCell = (value) => String(value ?? '').replace(/\r\n|[\t\r\n]/g, ' ');

/** Tab-separated, for a Google Sheets paste: tabs and line breaks in a value become spaces, one line per row. */
export const toTsv = ({ headers, rows }) =>
  [headers, ...rows].map(row => row.map(tsvCell).join('\t')).join('\n');

/** e.g. inscriptions_<theme>_2026-09-30.csv */
export const exportFileName = (prefix, theme, date = new Date()) =>
  `${prefix}_${theme || 'event'}_${date.toISOString().slice(0, 10)}.csv`;

/**
 * Hands `content` to the browser as a file download. A CSV is built with its BOM (toCsv), so the
 * bytes written are exactly `content`.
 */
export const downloadFile = (name, content, mime = 'text/csv;charset=utf-8;') => {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
