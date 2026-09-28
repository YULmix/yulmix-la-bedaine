import { parseDate } from './format.js';

// Which part of the yearly cycle an event is in, and the dated milestones behind it. The
// tunables are documented in docs/01-product-overview.md#registration-timeline: the intent
// phase opens z_intent_months before reg_start_date; registration closes (payments due)
// x_reg_close_weeks before the weekend.

const DAY_MS = 86400000;

const subtractMonths = (date, months) => {
  const result = new Date(date);
  result.setMonth(result.getMonth() - months);
  return result;
};

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * What the home page should offer. Kept identical to the pre-redesign HomeView logic.
 * @returns {'NO_EVENT'|'INTENT_PHASE'|'REGISTRATION_OPEN'|'ACTIVE_NO_REG'|'OTHER'}
 */
export const getEventPhase = (event, today = new Date()) => {
  if (!event) return 'NO_EVENT';
  const regStart = parseDate(event.reg_start_date);
  if (regStart) {
    const intentStart = subtractMonths(regStart, event.z_intent_months || 2);
    if (today >= intentStart && today < regStart) return 'INTENT_PHASE';
  }
  if (event.status === 'ACTIVE' && event.is_reg_open) return 'REGISTRATION_OPEN';
  if (event.status === 'ACTIVE') return 'ACTIVE_NO_REG';
  return 'OTHER';
};

/**
 * The registration close date (#38): event_start_date minus x_reg_close_weeks weeks. After it, a
 * member can no longer cancel or remove participants; the amount owed stays owed. Mirrors the
 * enforce_registration_lock_after_close_date trigger, which is what actually enforces it: null
 * (nothing locked) when either input is missing. Counts calendar days, not milliseconds, so a
 * daylight-saving change can't move it to the previous day.
 * @returns {Date|null}
 */
export const getRegistrationCloseDate = (event) => {
  const eventStart = parseDate(event?.event_start_date);
  if (!eventStart || event.x_reg_close_weeks == null) return null;
  const close = new Date(eventStart);
  close.setDate(close.getDate() - event.x_reg_close_weeks * 7);
  return close;
};

/** True once the close date has passed (the close date itself is still open, as in the trigger). */
export const isRegistrationLocked = (event, today = new Date()) => {
  const close = getRegistrationCloseDate(event);
  return !!close && startOfDay(today) > startOfDay(close);
};

/**
 * Dated milestones for the phase track. Milestones whose date can't be derived (no
 * event_start_date yet) are returned with date: null so the UI can show them as "à venir".
 * @returns {{ steps: Array<{id: string, date: Date|null}>, currentId: string|null, eventEnd: Date|null }}
 */
export const getEventTimeline = (event, today = new Date()) => {
  if (!event) return { steps: [], currentId: null, eventEnd: null };
  const regStart = parseDate(event.reg_start_date);
  const intentStart = regStart ? subtractMonths(regStart, event.z_intent_months || 2) : null;
  const eventStart = parseDate(event.event_start_date);
  const regClose = eventStart ? new Date(eventStart.getTime() - (event.x_reg_close_weeks || 1) * 7 * DAY_MS) : null;
  const eventEnd = eventStart ? new Date(eventStart.getTime() + Math.max((event.duration_days || 1) - 1, 0) * DAY_MS) : null;

  const steps = [
    { id: 'intent', date: intentStart },
    { id: 'registration', date: regStart },
    { id: 'payment', date: regClose },
    { id: 'weekend', date: eventStart }
  ];

  const now = startOfDay(today);
  let currentId = null;
  for (const step of steps) {
    if (step.date && now >= startOfDay(step.date)) currentId = step.id;
  }
  if (eventEnd && now > startOfDay(eventEnd)) currentId = 'done';

  return { steps, currentId, eventEnd };
};
