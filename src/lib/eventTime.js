// An event's start and its registration opening are instants (timestamptz, #149), entered and
// shown in one fixed time zone, whatever the viewer's browser is set to. The database reads them
// in the same zone (private.toronto_day()).

export const EVENT_TIME_ZONE = 'America/Toronto';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const partsFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: EVENT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

const pad = n => String(n).padStart(2, '0');

/** The instant as a Date, or null. A bare 'YYYY-MM-DD' (a date column, before #149) is midnight in the event zone. */
export const toInstant = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (DATE_ONLY.test(value)) return fromEventLocal(`${value}T00:00`);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Year, month (1-12), day, hour and minute of an instant, on the event zone's clock. */
export const eventClock = (value) => {
  const date = toInstant(value);
  if (!date) return null;
  const parts = Object.fromEntries(partsFormat.formatToParts(date).map(({ type, value: v }) => [type, Number(v)]));
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute };
};

/**
 * The event zone's wall-clock time 'YYYY-MM-DDTHH:mm' (a datetime-local input) as an instant.
 * A time the spring-forward jump skips (02:30 that night) lands an hour earlier; a time the
 * fall-back repeats is the first of the two.
 * @returns {Date|null}
 */
export function fromEventLocal(text) {
  const match = LOCAL_DATETIME.exec(text || '');
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // The zone's offset at a given instant, in ms; a first guess, then corrected once, handles DST.
  const offsetAt = (instant) => {
    const c = eventClock(new Date(instant));
    return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute) - instant;
  };
  let instant = wall - offsetAt(wall);
  instant = wall - offsetAt(instant);
  return new Date(instant);
}

/** An instant as the event zone's 'YYYY-MM-DDTHH:mm', for a datetime-local input; '' when unset. */
export const toEventLocal = (value) => {
  const c = eventClock(value);
  return c ? `${c.year}-${pad(c.month)}-${pad(c.day)}T${pad(c.hour)}:${pad(c.minute)}` : '';
};

/**
 * The calendar day an instant falls on in the event zone, as a local-midnight Date: day
 * arithmetic (close date, last day, travel range) and date-only display then work the same in
 * any browser zone.
 * @returns {Date|null}
 */
export const eventDay = (value) => {
  const c = eventClock(value);
  return c ? new Date(c.year, c.month - 1, c.day) : null;
};

/** True when the instant has a time of day worth showing (not midnight in the event zone). */
export const hasEventTime = (value) => {
  const c = eventClock(value);
  return !!c && (c.hour !== 0 || c.minute !== 0);
};

/** The time of day in the event zone, in French: "18 h 00". */
export const formatEventTime = (value) => {
  const date = toInstant(value);
  if (!date) return '';
  return date.toLocaleTimeString('fr-CA', { timeZone: EVENT_TIME_ZONE, hour: '2-digit', minute: '2-digit' });
};

/** The instant plus (or minus) whole months on the event zone's calendar, same wall-clock time. */
export const addEventMonths = (value, months) => {
  const c = eventClock(value);
  if (!c) return null;
  // Clamp the day, so 31 March minus one month is 28/29 February, not 3 March.
  const lastDay = new Date(Date.UTC(c.year, c.month - 1 + months + 1, 0)).getUTCDate();
  const target = new Date(Date.UTC(c.year, c.month - 1 + months, Math.min(c.day, lastDay)));
  return fromEventLocal(`${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(target.getUTCDate())}T${pad(c.hour)}:${pad(c.minute)}`);
};
