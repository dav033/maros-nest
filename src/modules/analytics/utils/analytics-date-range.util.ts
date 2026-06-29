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
