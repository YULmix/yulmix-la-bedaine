import { addEventMonths, eventDay, formatEventTime, hasEventTime, toInstant } from './eventTime';
import type { InstantLike } from './eventTime';

/** What the phase rules read of an events row. */
export interface PhasedEvent {
  status?: string | null;
  is_reg_open?: boolean | null;
  reg_start_date?: InstantLike;
  event_start_date?: InstantLike;
  z_intent_months?: number | null;
  x_reg_close_weeks?: number | null;
  duration_days?: number | null;
}

export type EventPhase = 'NO_EVENT' | 'INTENT_PHASE' | 'REGISTRATION_OPEN' | 'ACTIVE_NO_REG' | 'OTHER';

export interface TimelineStep {
  id: 'intent' | 'registration' | 'payment' | 'weekend';
  date: Date | null;
  time?: string;
}

// Which part of the yearly cycle an event is in, and the dated milestones behind it. The
// tunables are documented in docs/01-product-overview.md#registration-timeline: the intent
// phase opens z_intent_months before reg_start_date; registration closes (payments due)
// x_reg_close_weeks before the weekend.
//
// reg_start_date and event_start_date are instants (#149). Day-based rules use their calendar
// day in the event time zone (eventDay), as the database does, whatever the browser's zone.

// Calendar days, not milliseconds, so a daylight-saving change can't move a date to the day before.
const addDays = (day: Date, days: number): Date => new Date(day.getFullYear(), day.getMonth(), day.getDate() + days);

/**
 * What the home page should offer. Kept identical to the pre-redesign HomeView logic.
 * @returns {'NO_EVENT'|'INTENT_PHASE'|'REGISTRATION_OPEN'|'ACTIVE_NO_REG'|'OTHER'}
 */
export const getEventPhase = (event: PhasedEvent | null | undefined, today: Date = new Date()): EventPhase => {
  if (!event) return 'NO_EVENT';
  // To the minute: the intent phase ends when registration opens, at its time of day.
  const regStart = toInstant(event.reg_start_date);
  if (regStart) {
    const intentStart = addEventMonths(regStart, -(event.z_intent_months || 2));
    if (intentStart && today >= intentStart && today < regStart) return 'INTENT_PHASE';
  }
  if (event.status === 'ACTIVE' && event.is_reg_open) return 'REGISTRATION_OPEN';
  if (event.status === 'ACTIVE') return 'ACTIVE_NO_REG';
  return 'OTHER';
};

/**
 * The registration close date (#38): the event's start day minus x_reg_close_weeks weeks, as a
 * local-midnight Date for that day. After it, a member can no longer cancel or remove
 * participants; the amount owed stays owed. Mirrors private.registration_closed(), which is what
 * actually enforces it: null (nothing locked) when either input is missing.
 * @returns {Date|null}
 */
export const getRegistrationCloseDate = (event: PhasedEvent | null | undefined): Date | null => {
  const eventStart = eventDay(event?.event_start_date);
  if (!eventStart || event?.x_reg_close_weeks == null) return null;
  return addDays(eventStart, -event.x_reg_close_weeks * 7);
};

/** True once the close date's day has ended in the event zone (the close date itself is still open). */
export const isRegistrationLocked = (event: PhasedEvent | null | undefined, today: Date = new Date()): boolean => {
  const close = getRegistrationCloseDate(event);
  return !!close && eventDay(today)! > close;
};

/**
 * Dated milestones for the phase track, by day in the event zone (local-midnight Dates). The
 * registration opening and the weekend also carry their time of day ("18 h 00") when it isn't
 * midnight. Milestones whose date can't be derived (no event_start_date yet) are returned with
 * date: null so the UI can show them as "à venir".
 * @returns {{ steps: Array<{id: string, date: Date|null, time?: string}>, currentId: string|null, eventEnd: Date|null }}
 */
export const getEventTimeline = (
  event: PhasedEvent | null | undefined,
  today: Date = new Date()
): { steps: TimelineStep[]; currentId: TimelineStep['id'] | 'done' | null; eventEnd: Date | null } => {
  if (!event) return { steps: [], currentId: null, eventEnd: null };
  const regStartAt = toInstant(event.reg_start_date);
  const eventStartAt = toInstant(event.event_start_date);
  const eventStart = eventDay(eventStartAt);
  const timeOf = (at: Date | null): string | undefined => (hasEventTime(at) ? formatEventTime(at) : undefined);

  const steps: TimelineStep[] = [
    { id: 'intent', date: regStartAt ? eventDay(addEventMonths(regStartAt, -(event.z_intent_months || 2))) : null },
    { id: 'registration', date: eventDay(regStartAt), time: timeOf(regStartAt) },
    { id: 'payment', date: eventStart ? addDays(eventStart, -(event.x_reg_close_weeks || 1) * 7) : null },
    { id: 'weekend', date: eventStart, time: timeOf(eventStartAt) }
  ];
  const eventEnd = eventStart ? addDays(eventStart, Math.max((event.duration_days || 1) - 1, 0)) : null;

  const now = eventDay(today)!;
  let currentId: TimelineStep['id'] | 'done' | null = null;
  for (const step of steps) {
    if (step.date && now >= step.date) currentId = step.id;
  }
  if (eventEnd && now > eventEnd) currentId = 'done';

  return { steps, currentId, eventEnd };
};
