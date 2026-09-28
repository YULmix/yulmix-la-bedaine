/**
 * Format a CAD amount as French-Canadian currency (e.g. "123,45 $").
 * @param {number|null|undefined} amount
 * @returns {string}
 */
export const formatCurrency = (amount) => {
  if (amount === null || amount === undefined) return '';
  return new Intl.NumberFormat('fr-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2
  }).format(amount);
};

/**
 * Parse a date. A date-only 'YYYY-MM-DD' (Postgres `date` columns) is read as local midnight:
 * `new Date('2026-03-15')` is UTC midnight, which renders as March 14 in Montréal.
 * @param {string|Date|null|undefined} value
 * @returns {Date|null}
 */
export const parseDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  return new Date(value);
};

/**
 * Format a date as a short French-Canadian day and month (e.g. "15 mars").
 * @param {string|Date|null|undefined} value
 * @returns {string}
 */
export const formatShortDate = (value) => {
  const date = parseDate(value);
  if (!date) return '';
  return date.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long' });
};

/**
 * Format a date string as a long French-Canadian date (e.g. "15 mars 2026").
 * @param {string|null|undefined} dateString
 * @returns {string}
 */
export const formatDate = (dateString) => {
  if (!dateString) return '';
  const date = parseDate(dateString);
  return date.toLocaleDateString('fr-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

/**
 * Format a date string as a long French-Canadian date and time
 * (e.g. "15 mars 2026, 14:30").
 * @param {string|null|undefined} dateString
 * @returns {string}
 */
export const formatDateTime = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('fr-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};
