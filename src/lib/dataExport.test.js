import fr from '../locales/fr.json';
import {
  CSV_BOM,
  attendeeExportRows,
  exportFileName,
  partyExportRows,
  toCsv,
  toTsv
} from './dataExport';

const parties = [
  {
    id: 'a',
    status: 'registered',
    payment_status: 'paid',
    calculated_amount_owed: 360,
    profiles: { full_name: 'Alice Tremblay', email: 'alice@example.com' },
    transport: { type: 'offer', seats: 3, arrival: '2026-07-10T18:00', departure: '', departure_fsa: 'H2G', departure_place: 'Montréal' },
    logistics: { volunteering: ['other', 'cook_meal'], volunteering_other: 'Bricolage' },
    music_requests: 'Daft Punk',
    message_to_organizers: 'Ligne 1\nLigne "2", avec virgule',
    attendees: [
      {
        name: 'Alice', type: 'Adult', participation: 'Whole', sleeping_preference: 'bed',
        dietary_needs: ['vegan', 'other'], dietary_other: 'Arachides',
        place: { bed_label: 'Chalet · Ch. 1' }
      },
      { name: 'Léo', type: 'Kid', participation: 'After-Party', sleeping_preference: 'outside_other', sleeping_preference_other: 'Van', dietary_needs: ['none'] }
    ]
  },
  {
    id: 'b',
    status: 'registered',
    is_waitlisted: true,
    payment_status: 'unpaid',
    calculated_amount_owed: 90,
    profiles: { full_name: '', email: 'bob@example.com' },
    transport: { type: 'need', seats: 0 },
    logistics: {},
    attendees: [{ name: 'Bob', type: 'Teenager', participation: 'Main', dietary_needs: [] }]
  },
  {
    id: 'c',
    status: 'pending',
    payment_status: 'unpaid',
    calculated_amount_owed: 0,
    profiles: { full_name: 'Carla', email: 'carla@example.com' },
    transport: { type: 'None', departure_fsa: 'G1R', departure_place: 'Ignoré' },
    attendees: [{ name: 'Carla', type: 'Adult', participation: 'Main' }]
  },
  { id: 'x', status: 'cancelled', profiles: { full_name: 'Gone' }, attendees: [{ name: 'Gone' }] }
];

const column = ({ headers, rows }, header) => rows.map(row => row[headers.indexOf(header)]);

describe('partyExportRows', () => {
  const table = partyExportRows(parties);

  test('one row per non-cancelled party, then the totals', () => {
    expect(column(table, fr.exportPartyName)).toEqual(['Alice Tremblay', '', 'Carla', fr.exportTotals]);
    expect(table.rows.every(row => row.length === table.headers.length)).toBe(true);
  });

  test('status labels the waitlisted party', () => {
    expect(column(table, fr.exportStatus).slice(0, 3)).toEqual([fr.statusRegistered, fr.filterWaitlist, fr.statusPending]);
  });

  test('transport kind, seats offered or needed, times', () => {
    expect(column(table, fr.exportTransportType).slice(0, 3)).toEqual([fr.transportKindOffer, fr.transportKindNeed, fr.transportKindNone]);
    // A need saved without a count needs a seat per attendee; no lift, no seats.
    expect(column(table, fr.exportTransportSeats).slice(0, 3)).toEqual([3, 1, '']);
    expect(column(table, fr.exportArrival)[0]).toMatch(/2026/);
    expect(column(table, fr.exportDeparture)[0]).toBe('');
    // The departure place (#181) goes with a lift only; blank is an empty cell.
    expect(column(table, fr.exportDepartureFsa).slice(0, 3)).toEqual(['H2G', '', '']);
    expect(column(table, fr.exportDeparturePlace).slice(0, 3)).toEqual(['Montréal', '', '']);
  });

  test('volunteering in option order, with the party text in place of « Autre »', () => {
    expect(column(table, fr.exportVolunteering)[0]).toBe(`${fr.volunteeringCookMeal}, Bricolage`);
  });

  test('music and message as entered', () => {
    expect(column(table, fr.exportMusicRequests)[0]).toBe('Daft Punk');
    expect(column(table, fr.exportMessageToOrganizers)[0]).toBe('Ligne 1\nLigne "2", avec virgule');
  });

  test('totals ignore the waitlisted party', () => {
    const totals = table.rows.at(-1);
    expect(totals[table.headers.indexOf(fr.exportAdultWhole)]).toBe(1);
    expect(totals[table.headers.indexOf(fr.exportAdultMain)]).toBe(1);
    expect(totals[table.headers.indexOf(fr.exportTeenMain)]).toBe(0);
    expect(totals[table.headers.indexOf(fr.exportAmountOwed)]).toBe(360);
  });
});

describe('attendeeExportRows', () => {
  const table = attendeeExportRows(parties);

  test('one row per attendee, in party then attendee order, no money', () => {
    expect(column(table, fr.exportAttendeeName)).toEqual(['Alice', 'Léo', 'Bob', 'Carla']);
    expect(table.headers).not.toContain(fr.exportAmountOwed);
  });

  test('party contact falls back to the email', () => {
    expect(column(table, fr.exportPartyContact)).toEqual(['Alice Tremblay', 'Alice Tremblay', 'bob@example.com', 'Carla']);
  });

  test('type and participation (none for a kid)', () => {
    expect(column(table, fr.exportAttendeeType)).toEqual([fr.attendeeTypeAdult, fr.attendeeTypeKid, fr.attendeeTypeTeenager, fr.attendeeTypeAdult]);
    expect(column(table, fr.exportParticipation)).toEqual([fr.participationWhole, '', fr.participationPartial, fr.participationPartial]);
  });

  test('dietary labels and « Précisions alimentaires »; none or no answer is empty', () => {
    expect(column(table, fr.exportDietaryNeeds)).toEqual([`${fr.vegan}, ${fr.otherDietary}`, '', '', '']);
    expect(column(table, fr.exportDietaryOther)).toEqual(['Arachides', '', '', '']);
  });

  test('sleeping preference with its text, place, status', () => {
    expect(column(table, fr.exportSleepingPref).slice(0, 2)).toEqual([fr.accommodationBed, `${fr.accommodationOutsideOther} (Van)`]);
    expect(column(table, fr.exportSleepingAssigned)).toEqual(['Chalet · Ch. 1', '', '', '']);
    expect(column(table, fr.exportStatus)[2]).toBe(fr.filterWaitlist);
  });
});

describe('toCsv', () => {
  const tricky = 'Il a dit "salut", puis\nau revoir';
  const csv = toCsv({ headers: ['Nom', 'Note'], rows: [['Zoé', tricky], ['Bob', 3]] });

  test('starts with the BOM', () => {
    expect(csv.startsWith(CSV_BOM)).toBe(true);
  });

  test('a value with quotes, a comma and a line break round-trips', () => {
    expect(csv.slice(1)).toBe('"Nom","Note"\r\n"Zoé","Il a dit ""salut"", puis\nau revoir"\r\n"Bob","3"');
    // A minimal RFC 4180 reader gets the value back.
    const cells = [...csv.slice(1).matchAll(/"((?:[^"]|"")*)"/g)].map(m => m[1].replace(/""/g, '"'));
    expect(cells[3]).toBe(tricky);
  });
});

describe('toTsv', () => {
  test('one line per row: tabs and line breaks inside a value become spaces', () => {
    const tsv = toTsv({ headers: ['Nom', 'Note'], rows: [['Zoé', 'a\tb\r\nc\nd'], ['Bob', 3]] });
    expect(tsv.split('\n')).toEqual(['Nom\tNote', 'Zoé\ta b c d', 'Bob\t3']);
  });
});

test('exportFileName says which export', () => {
  expect(exportFileName('participants', 'Jungle', new Date('2026-09-30T12:00:00Z'))).toBe('participants_Jungle_2026-09-30.csv');
});
