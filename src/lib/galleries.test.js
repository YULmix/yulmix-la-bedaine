// The Supabase client reads import.meta.env, which Jest can't parse; these helpers don't use it.
jest.mock('./supabase', () => ({ supabase: {} }));

import { fitWithin, splitByRoom } from './galleries';

describe('fitWithin', () => {
  test('scales the longer side down to the limit, keeping proportions', () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  test('leaves a smaller image at its size', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
});

describe('splitByRoom', () => {
  test('takes every file while the gallery has room', () => {
    expect(splitByRoom(0, 3)).toEqual({ accepted: 3, refused: 0 });
    expect(splitByRoom(27, 3)).toEqual({ accepted: 3, refused: 0 });
  });

  test('refuses the files beyond 30', () => {
    expect(splitByRoom(28, 5)).toEqual({ accepted: 2, refused: 3 });
    expect(splitByRoom(30, 1)).toEqual({ accepted: 0, refused: 1 });
  });
});
