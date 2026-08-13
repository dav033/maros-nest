/**
 * Normalizes a query param that can arrive as a single value or an array (axios sends
 * `status[]=a&status[]=b` for an array, which the Express/qs query parser turns into
 * `{ status: ['a', 'b'] }` — but a single value comes through as a bare string, not a
 * one-element array) into always-an-array, so DTOs and the repository never have to
 * branch on which shape they got.
 */
export function toArray<T>(value: T | T[] | undefined): T[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}
