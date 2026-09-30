import { dbErrorMessage } from './dbErrors';
import fr from '../locales/fr.json';

const FALLBACK = 'fallback';

describe('dbErrorMessage', () => {
  test('maps a known code to its French text', () => {
    expect(dbErrorMessage({ message: 'root_admin_cannot_be_deleted' }, FALLBACK)).toBe(fr.dbErrorRootAdminCannotBeDeleted);
  });

  test('maps the registration-date order error (#141)', () => {
    expect(dbErrorMessage({ message: 'event_reg_start_not_before_event_start' }, FALLBACK)).toBe(fr.dbErrorEventRegStartNotBeforeEventStart);
  });

  test('fills in the parameters from details, formatting dates in French', () => {
    const message = dbErrorMessage({
      message: 'account_deletion_locked',
      details: JSON.stringify({ event: 'La Bédaine 2026', close_date: '2026-10-01' })
    }, FALLBACK);
    expect(message).toContain('« La Bédaine 2026 »');
    expect(message).toContain('1 octobre 2026');
    expect(message).not.toMatch(/\{event\}|\{date\}/);
  });

  test('never shows a raw database message: unknown codes and errors get the fallback', () => {
    expect(dbErrorMessage({ message: 'new row violates row-level security policy' }, FALLBACK)).toBe(FALLBACK);
    expect(dbErrorMessage({ message: 'toString' }, FALLBACK)).toBe(FALLBACK);
    expect(dbErrorMessage(null, FALLBACK)).toBe(FALLBACK);
  });

  test('tolerates missing or malformed details', () => {
    expect(dbErrorMessage({ message: 'account_deletion_locked', details: 'not json' }, FALLBACK)).not.toBe(FALLBACK);
    expect(dbErrorMessage({ message: 'account_deletion_locked' }, FALLBACK)).not.toBe(FALLBACK);
  });
});
