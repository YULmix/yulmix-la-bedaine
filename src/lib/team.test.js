import {
  isRootAdmin, levelOf, listAdminRoleLog, listAdmins, listPeople, matchesPerson, mergeTeamLog, listEditionTeam,
  personLabel, searchPeople, setEditionRole
} from './team';

// A Supabase client whose query records each builder call and resolves to `result`.
const mockClient = (result = { data: [], error: null }) => {
  const calls = [];
  const builder = new Proxy({}, {
    get: (_target, prop) => {
      if (prop === 'then') return (resolve, reject) => Promise.resolve(result).then(resolve, reject);
      return (...args) => { calls.push([prop, ...args]); return builder; };
    }
  });
  return { calls, client: { from: jest.fn(() => builder), rpc: jest.fn(async () => result) } };
};

describe('« Équipe » (#217)', () => {
  test('searchPeople matches name or email, quoted, with PostgREST syntax and wildcards taken out', async () => {
    const { client, calls } = mockClient({ data: [
      { id: 'a', full_name: 'Ana', email: 'ana@x.ca', is_admin: false },
      { id: 'r', full_name: null, email: 'yulmixalabedaine@gmail.com', is_admin: false }
    ], error: null });
    const people = await searchPeople(client, ' an,a(*) ');
    expect(calls.find(([name]) => name === 'or')[1]).toBe('full_name.ilike."*an a*",email.ilike."*an a*"');
    expect(calls).toContainEqual(['is', 'deleted_at', null]);
    // The root admin is an admin whatever its flag says.
    expect(people).toEqual([
      { id: 'a', full_name: 'Ana', email: 'ana@x.ca', isAdmin: false },
      { id: 'r', full_name: null, email: 'yulmixalabedaine@gmail.com', isAdmin: true }
    ]);
  });

  test('searchPeople asks nothing for an empty query', async () => {
    const { client } = mockClient();
    await expect(searchPeople(client, ' ,* ')).resolves.toEqual([]);
    expect(client.from).not.toHaveBeenCalled();
  });

  test('listEditionTeam is sorted by name', async () => {
    const { client } = mockClient({ data: [
      { role: 'organiser', person: { id: '2', full_name: 'Zoé', email: 'z@x' } },
      { role: 'committee', person: { id: '1', full_name: null, email: 'b@x' } }
    ], error: null });
    expect((await listEditionTeam(client, 'e')).map(member => personLabel(member.person))).toEqual(['b@x', 'Zoé']);
  });

  test('setEditionRole goes through set_edition_role(); null removes', async () => {
    const { client } = mockClient({ data: null, error: null });
    await setEditionRole(client, { eventId: 'e', userId: 'u', role: null });
    expect(client.rpc).toHaveBeenCalledWith('set_edition_role', { p_event_id: 'e', p_user_id: 'u', p_role: null });
  });

  test('listAdmins asks for flagged accounts and the root admin, by name', async () => {
    const { client, calls } = mockClient({ data: [
      { id: '2', full_name: 'Zoé', email: 'z@x' },
      { id: '1', full_name: null, email: 'yulmixalabedaine@gmail.com' }
    ], error: null });
    const admins = await listAdmins(client);
    expect(calls.find(([name]) => name === 'or')[1]).toBe('is_admin.eq.true,email.eq."yulmixalabedaine@gmail.com"');
    expect(calls).toContainEqual(['is', 'deleted_at', null]);
    expect(admins.map(personLabel)).toEqual(['yulmixalabedaine@gmail.com', 'Zoé']);
    expect(isRootAdmin(admins[0])).toBe(true);
    expect(isRootAdmin(admins[1])).toBe(false);
  });

  test('listPeople lists accounts by name; registeredOnly joins the edition\'s non-cancelled parties', async () => {
    const rows = [
      { id: 'b', full_name: 'Zoé', email: 'z@x', is_admin: null },
      { id: 'a', full_name: 'Ana', email: 'a@x', is_admin: true }
    ];
    const everyone = mockClient({ data: rows, error: null });
    const all = await listPeople(everyone.client, 'e');
    expect(all.people.map(person => [person.id, person.isAdmin])).toEqual([['a', true], ['b', false]]);
    expect(all.capped).toBe(false);
    expect(everyone.calls.some(([name]) => name === 'neq')).toBe(false);

    const registrants = mockClient({ data: rows, error: null });
    await listPeople(registrants.client, 'e', { registeredOnly: true });
    expect(registrants.calls).toContainEqual(['select', expect.stringContaining('user_parties!inner')]);
    expect(registrants.calls).toContainEqual(['eq', 'user_parties.event_id', 'e']);
    expect(registrants.calls).toContainEqual(['neq', 'user_parties.status', 'cancelled']);
    expect(registrants.calls).toContainEqual(['is', 'deleted_at', null]);
  });

  test('listPeople says capped past the cap, and keeps only the cap', async () => {
    const rows = [1, 2, 3].map(n => ({ id: String(n), full_name: `P${n}`, email: `${n}@x`, is_admin: false }));
    const { client, calls } = mockClient({ data: rows, error: null });
    const result = await listPeople(client, 'e', { cap: 2 });
    expect(calls).toContainEqual(['limit', 3]);
    expect(result.capped).toBe(true);
    expect(result.people).toHaveLength(2);
  });

  test('searchPeople can narrow to the edition\'s registrants', async () => {
    const { client, calls } = mockClient();
    await searchPeople(client, 'ana', 8, { eventId: 'e', registeredOnly: true });
    expect(calls).toContainEqual(['neq', 'user_parties.status', 'cancelled']);
  });

  test('matchesPerson ignores case and accents, in name or email', () => {
    const zoe = { id: '1', full_name: 'Zoé Tremblay', email: 'zt@x.ca' };
    expect(matchesPerson(zoe, '')).toBe(true);
    expect(matchesPerson(zoe, ' ZOE ')).toBe(true);
    expect(matchesPerson(zoe, 'zt@')).toBe(true);
    expect(matchesPerson(zoe, 'ana')).toBe(false);
  });

  test('levelOf: admin, else the role on the edition, else nothing', () => {
    const team = [{ role: 'committee', person: { id: 'c', full_name: 'C', email: 'c@x' } }];
    expect(levelOf({ id: 'a', isAdmin: true }, team)).toBe('admin');
    expect(levelOf({ id: 'c', isAdmin: false }, team)).toBe('committee');
    expect(levelOf({ id: 'm', isAdmin: false }, team)).toBeNull();
  });

  test('the admin log reads who granted or removed, and merges into the role log newest first', async () => {
    const person = { id: 'p', full_name: 'Pia', email: 'p@x' };
    const { client } = mockClient({ data: [
      { id: 5, changed_at: '2026-10-04T12:00:00Z', granted: true, person, actor: null }
    ], error: null });
    const adminLog = await listAdminRoleLog(client);
    expect(adminLog).toEqual([{ kind: 'admin', id: 5, changedAt: '2026-10-04T12:00:00Z', granted: true, person, actor: null }]);

    const role = (id, changedAt) => ({ kind: 'role', id, changedAt, oldRole: 'organiser', newRole: null, person, actor: null });
    const merged = mergeTeamLog(
      [role(9, '2026-10-04T12:00:00Z'), role(8, '2026-10-04T10:00:00Z')],
      [...adminLog, { ...adminLog[0], id: 6, changedAt: '2026-10-04T11:00:00Z', granted: false }]
    );
    // The tie at 12:00 (a promotion drops the role in the same transaction): the admin entry first.
    expect(merged.map(entry => `${entry.kind}${entry.id}`)).toEqual(['admin5', 'role9', 'admin6', 'role8']);
    expect(mergeTeamLog([role(1, '2026-10-04T10:00:00Z'), role(2, '2026-10-04T11:00:00Z')], [], 1).map(entry => entry.id)).toEqual([2]);
  });
});
