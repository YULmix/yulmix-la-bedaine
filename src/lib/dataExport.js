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
    fr.exportStatus
  ];

  const rows = exportedParties(allParties).flatMap(party => (party.attendees || []).map(attendee => [
    attendee.name || '',
    contactNameOf(party),
    getAttendeeTypeLabel(attendee.type),
    attendee.type === 'Kid' ? '' : getParticipationSummaryLabel(attendee.participation),
    dietaryNeedsOf(attendee.dietary_needs)
      .filter(value => value !== 'none')
      .map(value => getOptionLabel(DIETARY_OPTIONS, value))
      .join(', '),
    (attendee.dietary_other || '').trim(),
    sleepingPreferenceOf(attendee),
    attendee.place?.bed_label || '',
    statusOf(party)
  ]));

  return { headers, rows };
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
