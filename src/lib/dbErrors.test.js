import { appError, dbErrorMessage } from './dbErrors';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  test('the close-date locks show the close date (#102)', () => {
    const details = JSON.stringify({ close_date: '2026-10-01' });
    expect(dbErrorMessage({ message: 'registration_cancel_locked', details }, FALLBACK))
      .toBe(fr.cancelRegistrationLocked.replace('{date}', '1 octobre 2026'));
    expect(dbErrorMessage({ message: 'registration_attendee_removal_locked', details }, FALLBACK))
      .toBe(fr.dbErrorAttendeeRemovalLocked.replace('{date}', '1 octobre 2026'));
  });

  test('an appError keeps its own French message; a plain Error does not', () => {
    expect(dbErrorMessage(appError(fr.noRowReturnedError), FALLBACK)).toBe(fr.noRowReturnedError);
    expect(dbErrorMessage(new Error('Failed to fetch'), FALLBACK)).toBe(FALLBACK);
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

  test('every code the impersonate Edge Function returns is mapped (#266)', () => {
    const source = readFileSync(join(__dirname, '../../supabase/functions/impersonate/handler.ts'), 'utf8');
    const codes = new Set([...source.matchAll(/(?:Refusal|refuse)\('([a-z_]+)'/g)].map(match => match[1]));
    codes.delete('method_not_allowed'); // never reaches the app: it only sends POST
    expect(codes.size).toBeGreaterThan(5);
    for (const code of codes) expect([code, dbErrorMessage({ message: code }, FALLBACK)]).not.toEqual([code, FALLBACK]);
  });
});
