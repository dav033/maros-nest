import { DateChunk, ReportRow } from './quickbooks-reports.types';

export function splitDateRange(start: string, end: string): DateChunk[] {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) return [];

  const chunks: DateChunk[] = [];
  let chunkStart = new Date(startMs);
  const endDate = new Date(endMs);

  while (chunkStart <= endDate) {
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setUTCMonth(chunkEnd.getUTCMonth() + 6);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() - 1);

    const actualEnd = chunkEnd <= endDate ? chunkEnd : endDate;
    chunks.push({
      start: chunkStart.toISOString().slice(0, 10),
      end: actualEnd.toISOString().slice(0, 10),
    });

    chunkStart = new Date(actualEnd);
    chunkStart.setUTCDate(chunkStart.getUTCDate() + 1);
  }

  return chunks;
}

export function extractColumnTitles(rawReport: unknown): string[] {
  const report = rawReport as Record<string, unknown>;
  const cols = (report?.['Columns'] as Record<string, unknown>)?.['Column'];
  if (!Array.isArray(cols)) return [];
  return (cols as Record<string, unknown>[]).map((c) =>
    String(c?.['ColTitle'] ?? ''),
  );
}

export function parseQboReportRows(
  reportName: string,
  rawReport: unknown,
): ReportRow[] {
  const report = rawReport as Record<string, unknown>;
  const columnTitles = extractColumnTitles(rawReport);
  const topRows =
    ((report?.['Rows'] as Record<string, unknown>)?.['Row'] as unknown[]) ?? [];
  const output: ReportRow[] = [];
  walkQboRows(reportName, topRows, columnTitles, output, '', '', 0, []);
  return output;
}

export function buildReportSummary(rows: ReportRow[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const row of rows) {
    if (!row.label) continue;
    const key = row.section ? `${row.section}:${row.label}` : row.label;
    summary[key] = (summary[key] ?? 0) + row.amount;
  }
  return summary;
}

function walkQboRows(
  reportName: string,
  rows: unknown[],
  columnTitles: string[],
  output: ReportRow[],
  currentSection: string,
  currentGroup: string,
  depth: number,
  path: string[],
): void {
  for (const rawRow of rows) {
    const row = rawRow as Record<string, unknown>;
    const rowType = String(row['type'] ?? '');
    const rowGroup = String(row['group'] ?? '') || currentGroup;

    if (rowType === 'Section') {
      const header = row['Header'] as Record<string, unknown> | undefined;
      const headerData = (header?.['ColData'] as Record<string, unknown>[]) ?? [];
      const sectionLabel = String(headerData[0]?.['value'] ?? '');
      const newSection = sectionLabel || currentSection;
      const newPath = sectionLabel ? [...path, sectionLabel] : [...path];

      const nested =
        ((row['Rows'] as Record<string, unknown>)?.['Row'] as unknown[]) ?? [];
      walkQboRows(
        reportName,
        nested,
        columnTitles,
        output,
        newSection,
        rowGroup,
        depth + 1,
        newPath,
      );

      const summaryRaw = row['Summary'] as Record<string, unknown> | undefined;
      if (summaryRaw) {
        const colData = (summaryRaw['ColData'] as Record<string, unknown>[]) ?? [];
        if (colData.length) {
          output.push(
            buildQboRow(
              reportName,
              colData,
              columnTitles,
              newSection,
              rowGroup,
              depth,
              path,
            ),
          );
        }
      }
      continue;
    }

    const colData = (row['ColData'] as Record<string, unknown>[]) ?? [];
    if (colData.length) {
      output.push(
        buildQboRow(
          reportName,
          colData,
          columnTitles,
          currentSection,
          currentGroup,
          depth,
          path,
        ),
      );
    }
  }
}

function buildQboRow(
  reportName: string,
  colData: Record<string, unknown>[],
  columnTitles: string[],
  section: string,
  group: string,
  depth: number,
  path: string[],
): ReportRow {
  const first = colData[0] ?? {};
  const label = String(first['value'] ?? '');
  const entityIdRaw = String(first['id'] ?? '');

  const columns: Record<string, string> = {};
  let amount = 0;

  for (let i = 0; i < colData.length; i++) {
    const val = String(colData[i]?.['value'] ?? '');
    const title = columnTitles[i] || (i === 0 ? 'label' : `col_${i}`);
    columns[title] = val;
    if (i > 0) {
      const n = parseFloat(val.replace(/,/g, ''));
      if (!isNaN(n)) amount = n;
    }
  }

  const row: ReportRow = {
    reportName,
    section,
    group,
    label,
    columns,
    amount,
    depth,
    path: [...path],
  };
  if (entityIdRaw) row.entityId = entityIdRaw;
  return row;
}
