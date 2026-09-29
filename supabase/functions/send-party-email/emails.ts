// Pure logic for send-party-email: which emails a party is owed, and what they say.
// No Deno or network APIs here, so it is tested on its own (emails_test.ts).
//
// Copy comes from the email models in issue #12, in Quebec French. It lives here rather than in
// src/locales/fr.json because only the SPA bundles that file.

export type Template = 'registration' | 'waitlist' | 'promotion' | 'payment' | 'accommodation';

export interface Attendee {
  name?: string;
  // The attendee's place (#114), from the attendee_places view; null when they have none.
  place?: { place_id: string } | null;
}

export interface Party {
  id: string;
  status: string | null;
  is_waitlisted: boolean | null;
  payment_status: string | null;
  calculated_amount_owed: number | string | null;
  attendees: Attendee[] | null;
}

export interface EventInfo {
  theme: string;
  // The event's venue (#145), embedded; null when it has none.
  venue: { address: string | null } | null;
  event_start_date: string | null;
  is_active: boolean | null;
}

export interface Recipient {
  email: string;
  full_name: string | null;
}

export const hasAssignedBed = (attendees: Attendee[] | null): boolean =>
  (attendees ?? []).some(a => !!a.place);

// The emails this party is owed now and hasn't been sent (or claimed) yet, in sending order.
// State-based rather than event-based: it only looks at the committed row and email_log, so it
// gives the same answer however many times, or why, it is asked. The backfill in the migration
// that created email_log mirrors these conditions.
export function dueTemplates(party: Party, event: EventInfo, alreadyLogged: Iterable<Template>): Template[] {
  if (!event.is_active || party.status === 'cancelled') return [];
  const logged = new Set(alreadyLogged);
  const due: Template[] = [];

  if (party.is_waitlisted) {
    if (!logged.has('waitlist')) due.push('waitlist');
    return due; // no payment or bed emails while waitlisted
  }

  if (logged.has('waitlist')) {
    if (!logged.has('promotion')) due.push('promotion');
  } else if (!logged.has('registration')) {
    due.push('registration');
  }
  if (party.payment_status === 'paid' && !logged.has('payment')) due.push('payment');
  if (hasAssignedBed(party.attendees) && !logged.has('accommodation')) due.push('accommodation');
  return due;
}

// ---------------------------------------------------------------------------------------------
// Formatting (fr-CA): amounts as "1 234,50" followed by "$ CAD" in the copy, dates as "12 juin 2027".

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export function formatAmount(value: number | string | null): string {
  const n = Number(value ?? 0);
  const [whole, cents] = (Number.isFinite(n) ? n : 0).toFixed(2).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${cents}`;
}

export function formatDate(isoDate: string | null): string | null {
  const match = isoDate?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

export const mapsUrl = (address: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

// ---------------------------------------------------------------------------------------------
// Templates. A body is paragraphs of lines; a line is text or a link, so the plain-text and HTML
// versions come from the same source.

type Line = string | { text: string; href: string };
type Paragraph = Line[];

export interface EmailContext {
  fullName: string;
  eventTheme: string;
  amount: string;
  eventDate: string | null;
  venueAddress: string | null;
  attendeeNames: string[];
  siteUrl: string;
  interacEmail: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const SIGNATURE: Paragraph = ['YULmix - L’équipe de La Bédaine'];

const interac = (c: EmailContext): Paragraph => [
  `Destinataire : ${c.interacEmail}`,
  `Message / Note : Inscription Bédaine - ${c.fullName}`,
  '(Si une question de sécurité est requise : Question : Événement | Réponse : Bedaine)'
];

function details(c: EmailContext): Paragraph {
  const lines: Line[] = [];
  if (c.eventDate) lines.push(`Date : ${c.eventDate}`);
  if (c.venueAddress) {
    lines.push(`Lieu : ${c.venueAddress}`);
    lines.push({ text: 'Voir sur Google Maps', href: mapsUrl(c.venueAddress) });
  }
  if (c.attendeeNames.length) lines.push(`Participants : ${c.attendeeNames.join(', ')}`);
  return lines;
}

const TEMPLATES: Record<Template, (c: EmailContext) => { subject: string; body: Paragraph[] }> = {
  registration: c => ({
    subject: `Confirmation de votre inscription – ${c.eventTheme} | La Bédaine`,
    body: [
      [`Bonjour ${c.fullName},`],
      [`Votre inscription pour l’événement ${c.eventTheme} a bien été reçue!`],
      details(c),
      [`Total à payer : ${c.amount} $ CAD`],
      ['Instructions pour le paiement : veuillez effectuer votre virement Interac dès que possible afin de garantir votre place.'],
      interac(c),
      ['Vous pouvez consulter les détails complets et vos choix logistiques en tout temps sur l’application :', { text: c.siteUrl, href: c.siteUrl }],
      ['À bientôt!'],
      SIGNATURE
    ]
  }),
  payment: c => ({
    subject: `Paiement confirmé – ${c.eventTheme} | La Bédaine`,
    body: [
      [`Bonjour ${c.fullName},`],
      [`Nous confirmons la bonne réception de votre paiement de ${c.amount} $ CAD pour ${c.eventTheme}.`],
      ['Votre statut d’inscription est désormais marqué comme Payé. Vos places pour le groupe sont officiellement confirmées!'],
      ['Si vous devez apporter des modifications à vos disponibilités de transport ou à vos préférences, vous pouvez accéder à votre profil ici :', { text: c.siteUrl, href: c.siteUrl }],
      ['Merci et au plaisir de festoyer ensemble!'],
      SIGNATURE
    ]
  }),
  accommodation: c => ({
    subject: `Mise à jour de votre hébergement – ${c.eventTheme} | La Bédaine`,
    body: [
      [`Bonjour ${c.fullName},`],
      [`Les organisateurs ont mis à jour l’assignation de l’hébergement pour votre groupe pour l’événement ${c.eventTheme}.`],
      ['Pour des raisons de coordination, les détails précis des lits et chambres assignés sont disponibles directement dans votre espace participant. Rendez-vous sur l’application pour consulter votre assignation confirmée :', { text: '👉 Consulter mon assignation sur La Bédaine', href: c.siteUrl }],
      ['Rappel : les chambres peuvent être partagées avec d’autres personnes, il n’y a pas de chambres privées.'],
      SIGNATURE
    ]
  }),
  waitlist: c => ({
    subject: `Inscription sur liste d’attente – ${c.eventTheme} | La Bédaine`,
    body: [
      [`Bonjour ${c.fullName},`],
      [`L’événement ${c.eventTheme} a atteint sa capacité maximale pour le moment. Votre inscription a bien été enregistrée et votre groupe a été placé sur la liste d’attente.`],
      ['Important concernant le paiement : n’envoyez pas de virement Interac pour l’instant. Si une place se libère pour votre groupe, nous vous contacterons et vous serez invité à finaliser le paiement à ce moment-là.'],
      ['Vous pouvez vérifier votre statut sur l’application à tout moment :', { text: c.siteUrl, href: c.siteUrl }],
      ['Merci de votre intérêt et de votre patience!'],
      SIGNATURE
    ]
  }),
  promotion: c => ({
    subject: `Bonne nouvelle! Une place s’est libérée – ${c.eventTheme} | La Bédaine`,
    body: [
      [`Bonjour ${c.fullName},`],
      [`Une place vient de se libérer pour ${c.eventTheme} et votre groupe a été promu dans la liste principale des participants!`],
      [`Prochaine étape : pour confirmer définitivement votre présence, veuillez faire parvenir votre virement Interac de ${c.amount} $ CAD :`],
      interac(c),
      ['Connectez-vous sur l’application pour vérifier la composition de votre groupe et vos détails logistiques :', { text: '👉 Confirmer mes informations sur La Bédaine', href: c.siteUrl }],
      ['Au plaisir de vous y voir!'],
      SIGNATURE
    ]
  })
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const lineText = (line: Line) => (typeof line === 'string' ? line : `${line.text} : ${line.href}`);
const lineHtml = (line: Line) =>
  typeof line === 'string'
    ? escapeHtml(line)
    : `<a href="${escapeHtml(line.href)}">${escapeHtml(line.text)}</a>`;

export function renderEmail(template: Template, context: EmailContext): RenderedEmail {
  const { subject, body } = TEMPLATES[template](context);
  const paragraphs = body.filter(p => p.length > 0);
  const text = paragraphs.map(p => p.map(lineText).join('\n')).join('\n\n') + '\n';
  const html = [
    '<!doctype html><html lang="fr-CA"><head><meta charset="utf-8"></head>',
    '<body style="font-family: Arial, sans-serif; font-size: 15px; line-height: 1.5; color: #1a1a1a;">',
    ...paragraphs.map(p => `<p>${p.map(lineHtml).join('<br>')}</p>`),
    '</body></html>'
  ].join('\n');
  return { subject, text, html };
}

export function buildContext(
  party: Party,
  event: EventInfo,
  recipient: Recipient,
  settings: { siteUrl: string; interacEmail: string }
): EmailContext {
  const attendeeNames = (party.attendees ?? [])
    .map(a => (typeof a.name === 'string' ? a.name.trim() : ''))
    .filter(Boolean);
  return {
    fullName: recipient.full_name?.trim() || attendeeNames[0] || recipient.email,
    eventTheme: event.theme,
    amount: formatAmount(party.calculated_amount_owed),
    eventDate: formatDate(event.event_start_date),
    venueAddress: event.venue?.address?.trim() || null,
    attendeeNames,
    siteUrl: settings.siteUrl,
    interacEmail: settings.interacEmail
  };
}
