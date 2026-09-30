// Run with: deno test supabase/functions/send-party-email/
import assert from 'node:assert/strict';
import {
  buildContext,
  dueTemplates,
  formatAmount,
  formatDate,
  hasAssignedBed,
  renderEmail,
  type EventInfo,
  type Party
} from './emails.ts';

const event: EventInfo = { theme: 'La Bédaine 2027', venue: { address: '123 ch. du Lac, Val-David' }, event_start_date: '2027-06-12T04:00:00+00:00', is_active: true };
const party = (overrides: Partial<Party> = {}): Party => ({
  id: 'p1',
  status: 'registered',
  is_waitlisted: false,
  payment_status: 'unpaid',
  calculated_amount_owed: 280,
  attendees: [{ name: 'Léonie Carré', place: null }, { name: 'Gatien Carré' }],
  ...overrides
});

Deno.test('a new registration is owed the confirmation', () => {
  assert.deepEqual(dueTemplates(party(), event, []), ['registration']);
});

Deno.test('nothing is owed twice', () => {
  assert.deepEqual(dueTemplates(party(), event, ['registration']), []);
});

Deno.test('a waitlisted registration gets the waitlist notice only', () => {
  const p = party({ is_waitlisted: true, payment_status: 'paid', attendees: [{ place: { place_id: 'p1' } }] });
  assert.deepEqual(dueTemplates(p, event, []), ['waitlist']);
});

Deno.test('leaving the waitlist sends the promotion, not the confirmation', () => {
  assert.deepEqual(dueTemplates(party(), event, ['waitlist']), ['promotion']);
  assert.deepEqual(dueTemplates(party(), event, ['waitlist', 'promotion']), []);
});

Deno.test('a registered party pushed to the waitlist and back is told both times', () => {
  assert.deepEqual(dueTemplates(party({ is_waitlisted: true }), event, ['registration']), ['waitlist']);
  assert.deepEqual(dueTemplates(party(), event, ['registration', 'waitlist']), ['promotion']);
});

Deno.test('payment and bed assignment follow the confirmation', () => {
  const p = party({ payment_status: 'paid', attendees: [{ name: 'A', place: { place_id: 'p2' } }] });
  assert.deepEqual(dueTemplates(p, event, []), ['registration', 'payment', 'accommodation']);
  assert.deepEqual(dueTemplates(p, event, ['registration', 'payment', 'accommodation']), []);
});

Deno.test('cancelled parties and inactive events are owed nothing', () => {
  assert.deepEqual(dueTemplates(party({ status: 'cancelled' }), event, []), []);
  assert.deepEqual(dueTemplates(party(), { ...event, is_active: false }, []), []);
});

Deno.test('an attendee with no place is not an assignment', () => {
  assert.equal(hasAssignedBed([{ place: null }, {}]), false);
  assert.equal(hasAssignedBed(null), false);
  assert.equal(hasAssignedBed([{ place: null }, { place: { place_id: 'p1' } }]), true);
});

Deno.test('amounts and dates use the fr-CA formats', () => {
  assert.equal(formatAmount(280), '280,00');
  assert.equal(formatAmount('1530.5'), '1 530,50');
  assert.equal(formatAmount(null), '0,00');
  assert.equal(formatDate('2027-06-12'), '12 juin 2027');
  assert.equal(formatDate('2027-08-01'), '1 août 2027');
  assert.equal(formatDate(null), null);
  // An instant is read in Toronto: 23:30 on 12 June there is already the 13th in UTC (#149).
  assert.equal(formatDate('2027-06-13T03:30:00+00:00'), '12 juin 2027');
  assert.equal(formatDate('2027-01-15T05:00:00+00:00'), '15 janvier 2027');
  assert.equal(formatDate('nope'), null);
});

const context = buildContext(party(), event, { email: 'leonie@example.com', full_name: 'Léonie Carré' }, {
  siteUrl: 'https://www.yulmix.com/',
  interacEmail: 'yulmixalabedaine@gmail.com'
});

Deno.test('the confirmation carries the dues, Interac details, venue and attendees', () => {
  const email = renderEmail('registration', context);
  assert.equal(email.subject, 'Confirmation de votre inscription – La Bédaine 2027 | La Bédaine');
  for (const expected of [
    'Bonjour Léonie Carré,',
    'Total à payer : 280,00 $ CAD',
    'Destinataire : yulmixalabedaine@gmail.com',
    'Message / Note : Inscription Bédaine - Léonie Carré',
    'Date : 12 juin 2027',
    'Lieu : 123 ch. du Lac, Val-David',
    'Participants : Léonie Carré, Gatien Carré',
    'https://www.google.com/maps/search/?api=1&query=123%20ch.%20du%20Lac%2C%20Val-David'
  ]) assert.ok(email.text.includes(expected), `missing: ${expected}`);
});

Deno.test('the waitlist notice asks not to pay yet and names no amount', () => {
  const email = renderEmail('waitlist', context);
  assert.ok(email.text.includes('n’envoyez pas de virement Interac'));
  assert.ok(!email.text.includes('$ CAD'));
});

Deno.test('the promotion asks for the payment', () => {
  const email = renderEmail('promotion', context);
  assert.ok(email.subject.startsWith('Bonne nouvelle! Une place s’est libérée'));
  assert.ok(email.text.includes('virement Interac de 280,00 $ CAD'));
});

Deno.test('HTML keeps accents, escapes user text and links the app', () => {
  const html = renderEmail('accommodation', { ...context, eventTheme: 'Tom & <Jerry>' }).html;
  assert.ok(html.includes('<meta charset="utf-8">'));
  assert.ok(html.includes('Tom &amp; &lt;Jerry&gt;'));
  assert.ok(html.includes('<a href="https://www.yulmix.com/">👉 Consulter mon assignation sur La Bédaine</a>'));
  assert.ok(html.includes('L’équipe de La Bédaine'));
});

Deno.test('the name falls back to the first attendee, then the email', () => {
  const settings = { siteUrl: 'x', interacEmail: 'y' };
  assert.equal(buildContext(party(), event, { email: 'a@b.c', full_name: null }, settings).fullName, 'Léonie Carré');
  assert.equal(buildContext(party({ attendees: [] }), event, { email: 'a@b.c', full_name: ' ' }, settings).fullName, 'a@b.c');
});
