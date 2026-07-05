import { BadRequestException } from '@nestjs/common';

export type OptionalDateRange = { from?: string; to?: string };
export type DateRange = { from: string; to: string };

export function toDateString(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildDefaultLast12MonthsRange(baseDate: Date = new Date()): DateRange {
  const to = toDateString(baseDate);
  const fromDate = new Date(
    Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth() - 11, 1),
  );
  const from = toDateString(fromDate);
  return { from, to };
}

export function normalizeOptionalDateRange(
  range?: OptionalDateRange,
  maxMonths: number = 36,
): DateRange | undefined {
  if (!range?.from && !range?.to) {
    return undefined;
  }

  if (!range?.from || !range?.to) {
    throw new BadRequestException('Both "from" and "to" are required when using date range filter.');
  }

  const fromDate = parseIsoDate(range.from, 'from');
  const toDate = parseIsoDate(range.to, 'to');

  if (fromDate > toDate) {
    throw new BadRequestException('Invalid date range: "from" must be before or equal to "to".');
  }

  const monthDiff =
    (toDate.getUTCFullYear() - fromDate.getUTCFullYear()) * 12 +
    (toDate.getUTCMonth() - fromDate.getUTCMonth());
  if (monthDiff >= maxMonths) {
    throw new BadRequestException(
      `Date range too large: maximum allowed span is ${maxMonths} months.`,
    );
  }

  return {
    from: toDateString(fromDate),
    to: toDateString(toDate),
  };
}

/**
 * Devuelve las claves YYYY-MM del rango dado, o los últimos `months` meses
 * (incluyendo el actual) cuando no hay rango. Máximo 36 meses.
 */
export function buildMonthKeys(months: number, range?: DateRange): string[] {
  const cap = 36;
  const monthKey = (year: number, month: number) =>
    `${year}-${String(month + 1).padStart(2, '0')}`;

  if (range?.from && range?.to) {
    const fromDate = new Date(`${range.from}T00:00:00.000Z`);
    const toDate = new Date(`${range.to}T00:00:00.000Z`);
    const keys: string[] = [];
    for (
      let current = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), 1));
      current <= toDate && keys.length < cap;
      current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1))
    ) {
      keys.push(monthKey(current.getUTCFullYear(), current.getUTCMonth()));
    }
    return keys;
  }

  const safeMonths = Number.isFinite(months)
    ? Math.max(1, Math.min(cap, Math.trunc(months)))
    : 12;
  const now = new Date();
  const keys: string[] = [];
  for (let index = safeMonths - 1; index >= 0; index -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    keys.push(monthKey(date.getUTCFullYear(), date.getUTCMonth()));
  }
  return keys;
}

function parseIsoDate(value: string, label: 'from' | 'to'): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`Invalid ${label} date format. Use YYYY-MM-DD.`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || toDateString(date) !== value) {
    throw new BadRequestException(`Invalid ${label} date value.`);
  }

  return date;
}
