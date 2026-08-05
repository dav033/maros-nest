export interface PositionedSibling {
  id: number;
  position: number;
}

/**
 * Computes where a page should be inserted among its (already-excluded-self) siblings.
 * Returns null when the gap between neighbors has collapsed and the caller must rebalance
 * the sibling list to clean multiples of `step` before retrying.
 */
export function computeInsertPosition(
  siblings: PositionedSibling[],
  step: number,
  beforeId?: number | null,
  afterId?: number | null,
): number | null {
  if (afterId != null) {
    const idx = siblings.findIndex((s) => s.id === afterId);
    if (idx === -1) return step;
    const afterPos = siblings[idx].position;
    const next = siblings[idx + 1];
    if (!next) return afterPos + step;
    const mid = Math.floor((afterPos + next.position) / 2);
    return mid > afterPos && mid < next.position ? mid : null;
  }

  if (beforeId != null) {
    const idx = siblings.findIndex((s) => s.id === beforeId);
    if (idx === -1) return step;
    const beforePos = siblings[idx].position;
    const prev = siblings[idx - 1];
    if (!prev) return beforePos - step;
    const mid = Math.floor((prev.position + beforePos) / 2);
    return mid > prev.position && mid < beforePos ? mid : null;
  }

  const last = siblings[siblings.length - 1];
  return last ? last.position + step : step;
}
