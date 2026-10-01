import { loadedIndexes, stepIndex, swipeOffset } from './carousel';

describe('stepIndex', () => {
  test('moves by one', () => {
    expect(stepIndex(1, 1, 5)).toBe(2);
    expect(stepIndex(3, -1, 5)).toBe(2);
  });

  test('wraps around both ends', () => {
    expect(stepIndex(4, 1, 5)).toBe(0);
    expect(stepIndex(0, -1, 5)).toBe(4);
  });

  test('stays on a single image, and on 0 for none', () => {
    expect(stepIndex(0, 1, 1)).toBe(0);
    expect(stepIndex(0, -1, 0)).toBe(0);
  });
});

describe('swipeOffset', () => {
  test('a swipe left shows the next image, a swipe right the previous one', () => {
    expect(swipeOffset(-80, 5)).toBe(1);
    expect(swipeOffset(80, -5)).toBe(-1);
  });

  test('a short move, or a mostly vertical one, does nothing', () => {
    expect(swipeOffset(-49, 0)).toBe(0);
    expect(swipeOffset(-60, 90)).toBe(0);
    expect(swipeOffset(0, 0)).toBe(0);
  });

  test('the threshold itself counts', () => {
    expect(swipeOffset(-50, 0)).toBe(1);
  });
});

describe('loadedIndexes', () => {
  test('the current image and its neighbours, wrapping', () => {
    expect([...loadedIndexes(0, 5)].sort()).toEqual([0, 1, 4]);
  });

  test('no repeats in a small gallery', () => {
    expect([...loadedIndexes(0, 1)]).toEqual([0]);
    expect([...loadedIndexes(0, 2)].sort()).toEqual([0, 1]);
  });
});
