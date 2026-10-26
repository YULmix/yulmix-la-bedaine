import { eventClock, fromEventLocal, toInstant } from './eventTime';
import type { InstantLike } from './eventTime';

// The post-mortem (« bilan », #315, ADR 0029) closes at the end of the Toronto day
// "last day + feedback_days". The database computes it (private.event_feedback_dates()) but only
// for a saved row, and the event form needs it for the values being typed, so this mirrors it;
// eventFeedback.test.js pins the two together on dates taken from the database's function.

export const FEEDBACK_DAYS_DEFAULT = 14;
export const FEEDBACK_DAYS_MAX = 365;

export interface FeedbackEvent {
  status?: string | null;
  event_start_date?: InstantLike;
  duration_days?: number | string | null;
  feedback_days?: number | string | null;
  feedback_closed_at?: InstantLike;
}

export type FeedbackState = 'not_yet' | 'open' | 'closed';

export interface FeedbackWindow {
  state: FeedbackState;
  /** The last Toronto day one may answer, as a local-midnight Date; null without a start date or a valid offset. */
  closesOn: Date | null;
  /** The instant the feedback closes by date: the start of the next Toronto day. */
  closesAt: Date | null;
  /** The Toronto day the close really happened (the marker's), when it already did. */
  closedOn: Date | null;
}

const pad = (n: number): string => String(n).padStart(2, '0');
const localDay = (c: { year: number; month: number; day: number }): Date => new Date(c.year, c.month - 1, c.day);

// Calendar days on UTC arithmetic: no daylight-saving drift.
const plusDays = (c: { year: number; month: number; day: number }, days: number) => {
  const d = new Date(Date.UTC(c.year, c.month - 1, c.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};
const midnight = (c: { year: number; month: number; day: number }): Date =>
  fromEventLocal(`${c.year}-${pad(c.month)}-${pad(c.day)}T00:00`)!;

// The event form's draft holds the start as the datetime-local input's text, in the event zone.
const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const startInstant = (value: InstantLike): InstantLike =>
  (typeof value === 'string' && LOCAL_DATETIME.test(value) ? fromEventLocal(value) : value);

const wholeNumber = (value: number | string | null | undefined): number | null => {
  const text = String(value ?? '').trim();
  return /^\d+$/.test(text) ? Number(text) : null;
};

/**
 * The state and dates of an event's post-mortem window. Mirrors private.event_feedback_window():
 * closed once the marker is set or the event is archived; not yet for a non-ACTIVE event or one
 * without a start date; otherwise closed from the close instant, open from the first answerable
 * day, not yet before.
 */
export const getFeedbackWindow = (event: FeedbackEvent | null | undefined, now: Date = new Date()): FeedbackWindow => {
  const start = eventClock(startInstant(event?.event_start_date));
  const days = wholeNumber(event?.feedback_days ?? FEEDBACK_DAYS_DEFAULT);
  const duration = wholeNumber(event?.duration_days ?? 1) ?? 1;
  // The marker is the scheduled close (a Toronto midnight, which belongs to the day before) or the
  // moment of an earlier close (archival, a save): one millisecond back gives the day it closed on.
  const marker = toInstant(event?.feedback_closed_at);
  const closedOn = marker ? eventClock(new Date(marker.getTime() - 1)) : null;
  const done = !!closedOn || event?.status === 'ARCHIVED';

  let closesOn = null;
  let closesAt = null;
  let opensAt = null;
  if (start && days != null && days >= 1) {
    const opens = plusDays(start, duration);
    opensAt = midnight(opens);
    closesOn = localDay(plusDays(opens, days - 1));
    closesAt = midnight(plusDays(opens, days));
  }
  let state: FeedbackState = 'not_yet';
  if (done) state = 'closed';
  else if (event?.status === 'ACTIVE' && closesAt && opensAt) {
    if (closesAt.getTime() <= now.getTime()) state = 'closed';
    else if (opensAt.getTime() <= now.getTime()) state = 'open';
  }
  return { state, closesOn, closesAt, closedOn: closedOn ? localDay(closedOn) : null };
};

/** True when saving `after` closes the feedback for good while `before` still has it not closed. */
export const closesOnSave = (before: FeedbackEvent, after: FeedbackEvent, now: Date = new Date()): boolean =>
  getFeedbackWindow(before, now).state !== 'closed' && getFeedbackWindow(after, now).state === 'closed';
