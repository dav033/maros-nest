import { toArray } from './toArray.util';

describe('toArray', () => {
  it('wraps a single value in an array', () => {
    expect(toArray('todo')).toEqual(['todo']);
  });

  it('leaves an already-array value untouched', () => {
    expect(toArray(['todo', 'done'])).toEqual(['todo', 'done']);
  });

  it('leaves undefined as undefined — no filter was sent at all', () => {
    expect(toArray(undefined)).toBeUndefined();
  });
});
