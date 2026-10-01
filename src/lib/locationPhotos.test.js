// The Supabase client reads import.meta.env, which Jest can't parse; fitWithin doesn't use it.
jest.mock('./supabase', () => ({ supabase: {} }));

import { fitWithin } from './locationPhotos';

describe('fitWithin', () => {
  test('scales the longer side down to the limit, keeping proportions', () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  test('leaves a smaller image at its size', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
});
