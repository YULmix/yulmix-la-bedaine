import { listEditionTeam, personLabel, searchPeople, setEditionRole } from './team';

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
});
