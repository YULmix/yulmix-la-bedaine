// Example test to verify Jest setup
describe('Jest Setup Verification', () => {
  test('Basic arithmetic works', () => {
    expect(1 + 2).toBe(3);
  });

  test('Environment variables load', () => {
    expect(process.env.NODE_ENV).toBeDefined();
  });
});