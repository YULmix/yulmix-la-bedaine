// Which event the app is about (#192): the one marked active, or else the newest (`events` come
// newest first), so a fresh install with only drafts still shows something to admins. The others
// are listed apart. The app shell and the admin view both ask this, so they can't disagree.

/**
 * @param {Array<object>} events newest first
 * @returns {{ activeEvent: object|null, otherEvents: object[] }}
 */
export const splitEvents = (events) => {
  const all = events || [];
  const activeEvent = all.find(event => event.is_active) || all[0] || null;
  return { activeEvent, otherEvents: all.filter(event => event !== activeEvent) };
};
