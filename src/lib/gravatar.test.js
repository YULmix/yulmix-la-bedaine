import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { gravatarUrl } from './gravatar';

beforeAll(() => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  if (!globalThis.TextEncoder) globalThis.TextEncoder = TextEncoder;
});

// sha256("myemailaddress@example.com"), checked with sha256sum.
const HASH = '84059b07d4be67b806386c0aad8070a23f18836bbaae342275dc0a83414c32ee';

describe('gravatarUrl', () => {
  it('hashes the address with SHA-256 and asks for a 404 when there is no Gravatar', async () => {
    expect(await gravatarUrl('myemailaddress@example.com', 64)).toBe(`https://www.gravatar.com/avatar/${HASH}?s=64&d=404`);
  });

  it('trims and lower-cases the address first', async () => {
    expect(await gravatarUrl('  MyEmailAddress@Example.COM ', 64)).toBe(`https://www.gravatar.com/avatar/${HASH}?s=64&d=404`);
  });
});
