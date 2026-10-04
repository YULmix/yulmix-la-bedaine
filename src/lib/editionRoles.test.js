import { ACTION_ROLES, can, fetchMyEditionRoles, hasRole, organiserEditions, roleOn } from './editionRoles';

describe('the role ladder (#217, ADR 0023)', () => {
  test('each rung includes the ones below; no role is below every rung', () => {
    expect(hasRole('committee', 'committee')).toBe(true);
    expect(hasRole('committee', 'organiser')).toBe(false);
    expect(hasRole('organiser', 'committee')).toBe(true);
    expect(hasRole('organiser', 'admin')).toBe(false);
    expect(hasRole('admin', 'organiser')).toBe(true);
    expect(hasRole(null, 'committee')).toBe(false);
    expect(hasRole(undefined, 'committee')).toBe(false);
    expect(hasRole('member', 'committee')).toBe(false);
  });

  test('Comité only reads; Organisateur runs the edition; editing a registration and the admin flag are an admin\'s', () => {
    const allowed = role => Object.keys(ACTION_ROLES).filter(action => can(role, action)).sort();
    expect(allowed('committee')).toEqual([]);
    expect(allowed('organiser')).toEqual(['budgetFigures', 'emailProblems', 'exportData', 'markPayment', 'saveLogistics']);
    expect(allowed('admin')).toEqual(Object.keys(ACTION_ROLES).sort());
    expect(allowed(null)).toEqual([]);
  });

  test('roleOn: an admin is admin on every event; anyone else has the role granted for that one', () => {
    const roles = { a: 'committee', b: 'organiser' };
    expect(roleOn('a', { isAdmin: false, roles })).toBe('committee');
    expect(roleOn('b', { isAdmin: false, roles })).toBe('organiser');
    expect(roleOn('c', { isAdmin: false, roles })).toBeNull();
    expect(roleOn(null, { isAdmin: false, roles })).toBeNull();
    expect(roleOn('c', { isAdmin: true, roles: {} })).toBe('admin');
    expect(roleOn(null, { isAdmin: true, roles: {} })).toBe('admin');
  });

  test('organiserEditions: an organiser\'s editions, past ones included; every one for an admin', () => {
    const events = [{ id: 'now' }, { id: 'past' }, { id: 'other' }];
    expect(organiserEditions(events, { isAdmin: false, roles: { now: 'committee', past: 'organiser' } })).toEqual([{ id: 'past' }]);
    expect(organiserEditions(events, { isAdmin: true, roles: {} })).toEqual(events);
    expect(organiserEditions(events, { isAdmin: false, roles: {} })).toEqual([]);
  });
});

describe('fetchMyEditionRoles', () => {
  const client = (result) => {
    const calls = [];
    const builder = {
      select: (...args) => { calls.push(['select', ...args]); return builder; },
      eq: (...args) => { calls.push(['eq', ...args]); return Promise.resolve(result); }
    };
    return { calls, from: jest.fn(() => builder) };
  };

  test('reads the person\'s own rows into roles by event', async () => {
    const db = client({ data: [{ event_id: 'a', role: 'committee' }, { event_id: 'b', role: 'organiser' }], error: null });
    await expect(fetchMyEditionRoles(db, 'u1')).resolves.toEqual({ a: 'committee', b: 'organiser' });
    expect(db.from).toHaveBeenCalledWith('edition_roles');
    expect(db.calls).toContainEqual(['eq', 'user_id', 'u1']);
  });

  test('a failure throws a French message', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const db = client({ data: null, error: { message: 'boom' } });
    await expect(fetchMyEditionRoles(db, 'u1')).rejects.toMatchObject({ isAppMessage: true });
    console.error.mockRestore();
  });
});
