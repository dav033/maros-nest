import { computeInsertPosition } from './note-position.util';

describe('computeInsertPosition', () => {
  const STEP = 1000;

  it('appends after the last sibling when no anchor is given', () => {
    const siblings = [{ id: 1, position: 1000 }, { id: 2, position: 2000 }];
    expect(computeInsertPosition(siblings, STEP)).toBe(3000);
  });

  it('returns the step when there are no siblings yet', () => {
    expect(computeInsertPosition([], STEP)).toBe(STEP);
  });

  it('places after a given sibling with room to spare', () => {
    const siblings = [{ id: 1, position: 1000 }, { id: 2, position: 3000 }];
    expect(computeInsertPosition(siblings, STEP, undefined, 1)).toBe(2000);
  });

  it('places before a given sibling with room to spare', () => {
    const siblings = [{ id: 1, position: 1000 }, { id: 2, position: 3000 }];
    expect(computeInsertPosition(siblings, STEP, 2)).toBe(2000);
  });

  it('appends past the last sibling when afterId is the last one', () => {
    const siblings = [{ id: 1, position: 1000 }, { id: 2, position: 2000 }];
    expect(computeInsertPosition(siblings, STEP, undefined, 2)).toBe(3000);
  });

  it('inserts before the first sibling when beforeId is the first one', () => {
    const siblings = [{ id: 1, position: 1000 }, { id: 2, position: 2000 }];
    expect(computeInsertPosition(siblings, STEP, 1)).toBe(0);
  });

  it('returns null when the gap between neighbors has collapsed', () => {
    const siblings = [{ id: 1, position: 1000 }, { id: 2, position: 1001 }];
    expect(computeInsertPosition(siblings, STEP, undefined, 1)).toBeNull();
  });

  it('falls back to append when the anchor id is not among the siblings', () => {
    const siblings = [{ id: 1, position: 1000 }];
    expect(computeInsertPosition(siblings, STEP, undefined, 999)).toBe(STEP);
  });
});
