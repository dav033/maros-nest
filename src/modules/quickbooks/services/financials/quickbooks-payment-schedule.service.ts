import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import axios from 'axios';
import pdfParse from 'pdf-parse';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
import { QBO_ATTACHMENT_CONCURRENCY, runWithConcurrency } from '../core/quickbooks-concurrency.utils';
import { QuickbooksAttachmentsHelpers } from '../attachments/quickbooks-attachments.helpers';
import { QuickbooksFinancialsContextService } from './quickbooks-financials-context.service';
import {
  PaymentSchedule,
  PaymentScheduleBasis,
  PaymentScheduleItem,
} from './quickbooks-financials.types';

type QboTransaction = Record<string, unknown> & {
  Id?: unknown;
  CustomerRef?: unknown;
};

type Candidate = {
  projectNumber: string;
  entityType: 'Estimate' | 'Invoice' | 'Customer' | null;
  entityId: string | null;
  matchedBy: PaymentSchedule['source']['matchedBy'];
  attachment: Record<string, unknown>;
  /** Menor = evidencia más fuerte de que el PDF es de este proyecto. */
  rank: number;
};

type ParsedSchedule = Omit<PaymentSchedule, 'source'>;

const PDF_CONTENT_TYPE = 'application/pdf';
const PDF_DOWNLOAD_TIMEOUT_MS = 20_000;
const PDF_MAX_BYTES = 12 * 1024 * 1024;

/**
 * Fuerza del vínculo PDF -> proyecto. Un adjunto colgado del Estimate del job
 * es prueba directa; el nombre de archivo es la última opción porque en QBO hay
 * proposals mal nombrados (un "Proposal 015-0125" que en realidad es de otro
 * proyecto), así que solo se usa cuando no hay nada mejor.
 */
const RANK_ESTIMATE = 0;
const RANK_INVOICE = 1;
const RANK_CUSTOMER = 2;
const RANK_FILENAME = 3;

/** Los proposals se nombran con el lead number: "024-0325", "050P-0326". */
const PROJECT_NUMBER_IN_NAME = /\b(\d{3}[A-Za-z]?-\d{4,6})\b/g;

const MAX_CANDIDATES_PER_PROJECT = 3;
const SCHEDULES_CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Encabezados bajo los que aparece la tabla. Maros emite proposals en inglés y
 * en español — "7. Cronograma de Pagos" y "6. FORMA DE PAGO" traen la misma
 * tabla que sus equivalentes en inglés, y sin estos anclajes se descartaban
 * documentos perfectamente parseables.
 */
const SCHEDULE_ANCHORS = [
  /payment\s+schedule/i,
  /payment\s+milestone/i,
  /cronograma\s+de\s+pagos?/i,
  /forma\s+de\s+pago/i,
  /plan\s+de\s+pagos?/i,
  /programa\s+de\s+pagos?/i,
];

@Injectable()
export class QuickbooksPaymentScheduleService {
  private readonly logger = new Logger(QuickbooksPaymentScheduleService.name);
  private readonly helpers = new QuickbooksAttachmentsHelpers();

  constructor(
    private readonly apiService: QuickbooksApiService,
    private readonly contextService: QuickbooksFinancialsContextService,
    @Inject(CACHE_MANAGER) private readonly cacheManager?: Cache,
  ) {}

  /**
   * Finds the first readable Payment Schedule PDF for each project. Looks at
   * attachments hanging off the project's Estimates and Invoices, off the job
   * customer itself, and — as a last resort — at PDFs whose file name carries
   * the project number. Metadata is fetched in batches; PDF downloads stay
   * bounded so this does not multiply QBO requests per project.
   */
  async getByProjects(
    projectNumbers: string[],
    realmId?: string,
  ): Promise<Map<string, PaymentSchedule | null>> {
    const result = new Map<string, PaymentSchedule | null>(
      [...new Set(projectNumbers.filter(Boolean))].map((number) => [number, null]),
    );
    if (!projectNumbers.length) return result;

    try {
      const effectiveRealmId = realmId ?? (await this.contextService.resolveDefaultRealmId());

      // Descargar y parsear los PDF es lo más caro de todo el enriquecimiento y
      // corre dentro del presupuesto de 25s de findAllFinancials. Los proposals
      // cambian de mes en mes, así que se cachea el resultado ya parseado.
      const cacheKey = this.buildCacheKey(effectiveRealmId, [...result.keys()]);
      const cached = await this.cacheManager?.get<Array<[string, PaymentSchedule | null]>>(cacheKey);
      if (cached) return new Map(cached);

      const context = await this.contextService.resolveJobs(effectiveRealmId, projectNumbers);
      if (!context.jobIds.length) return result;

      const customerIds = context.jobIds
        .map((id) => `'${String(id).replace(/'/g, "\\'")}'`)
        .join(',');
      const [estimates, invoices, attachments] = await Promise.all([
        this.apiService.queryAll(effectiveRealmId, 'Estimate', {
          where: `CustomerRef IN (${customerIds})`,
          select: 'Id, CustomerRef',
          cacheKey: 'payment-schedule-transactions',
        }) as Promise<QboTransaction[]>,
        this.apiService.queryAll(effectiveRealmId, 'Invoice', {
          where: `CustomerRef IN (${customerIds})`,
          select: 'Id, CustomerRef',
          cacheKey: 'payment-schedule-transactions',
        }) as Promise<QboTransaction[]>,
        this.apiService.queryAll(effectiveRealmId, 'Attachable', {
          select: 'Id, FileName, ContentType, Size, Note, AttachableRef',
          cacheKey: 'payment-schedule-attachments',
        }) as Promise<Record<string, unknown>[]>,
      ]);

      const projectByTransaction = this.indexTransactions(
        estimates,
        invoices,
        context.jobIds,
        context.jobMap,
      );
      const candidates = this.buildCandidates(
        attachments,
        projectByTransaction,
        context.jobMap,
        [...result.keys()],
      );
      const parsed = await runWithConcurrency(
        candidates.map((candidate) => async () =>
          this.readCandidate(effectiveRealmId, candidate),
        ),
        QBO_ATTACHMENT_CONCURRENCY,
      );

      for (const schedule of parsed) {
        if (!schedule) continue;
        const current = result.get(schedule.projectNumber);
        if (current) continue;
        result.set(schedule.projectNumber, schedule.value);
      }

      await this.cacheManager?.set(cacheKey, [...result.entries()], SCHEDULES_CACHE_TTL_MS);
    } catch (error) {
      this.logger.warn(
        `Payment Schedule lookup skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return result;
  }

  /**
   * Los proposals no comparten un solo formato. Se intenta cada anclaje posible
   * ("Payment Schedule" y la cabecera "Payment Milestone ... Percentage ...
   * Amount") y, dentro de cada uno, los tres layouts vistos en producci\u00f3n:
   * fila en una l\u00ednea, bloques por hito, y porcentaje/monto en l\u00edneas sueltas.
   */
  parseText(text: string): ParsedSchedule | null {
    const lines = text
      .replace(/\u00a0/g, ' ')
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    for (const body of this.scheduleBodies(lines)) {
      const parsed =
        this.parseInlineRows(body) ??
        this.parseMilestoneBlocks(body) ??
        this.parseStackedRows(body);
      if (parsed) return parsed;
    }
    return null;
  }

  /** Rebanadas del documento donde puede vivir la tabla, en orden de aparici\u00f3n. */
  private scheduleBodies(lines: string[]): string[][] {
    const anchors: number[] = [];
    lines.forEach((line, index) => {
      if (SCHEDULE_ANCHORS.some((anchor) => anchor.test(line))) anchors.push(index);
    });
    return anchors.map((anchor) => lines.slice(anchor + 1, anchor + 45));
  }

  private parseInlineRows(body: string[]): ParsedSchedule | null {
    const inlineRows = body.flatMap((line) => {
      const match = line.match(
        /^(.+?)\s+(\d+(?:\.\d+)?)\s*%\s+\$?\s*([\d,]+(?:\.\d{2})?)$/,
      );
      if (!match) return [];
      const label = match[1].trim();
      const percentage = Number(match[2]);
      const amount = Number(match[3].replace(/,/g, ''));
      if (!label || !Number.isFinite(percentage) || !Number.isFinite(amount)) return [];
      return [{ label, percentage, amount }];
    });
    if (!inlineRows.length) return null;

    const scheduleRows = inlineRows.filter((row) => !/^total\b/i.test(row.label));
    if (!scheduleRows.length) return null;
    const totalRow = inlineRows.find((row) => /^total\b/i.test(row.label));
    return this.withBasis({
      items: scheduleRows,
      totalPercentage:
        totalRow?.percentage ?? scheduleRows.reduce((sum, item) => sum + item.percentage, 0),
      totalAmount: totalRow?.amount ?? scheduleRows.reduce((sum, item) => sum + item.amount, 0),
    });
  }

  /**
   * Formato actual de los proposals de Maros: cada hito abre con
   * "Payment No. N – ..." y su porcentaje/monto puede venir en las líneas
   * siguientes, como "Fixed Amount $5,000.00" o "35% of Remaining Balance".
   */
  private parseMilestoneBlocks(body: string[]): ParsedSchedule | null {
    const starts = body
      .map((line, index) => ({ line, index }))
      .filter((row) => /^payment\s*(no\.?|number|#)\s*\d+/i.test(row.line))
      .map((row) => row.index);
    if (starts.length < 2) return null;

    const totalIndex = body.findIndex(
      (line, index) => index > starts[0] && /^total\b/i.test(line),
    );
    const end = totalIndex >= 0 ? totalIndex : body.length;

    const items: PaymentScheduleItem[] = [];
    starts.forEach((start, position) => {
      const stop = Math.min(starts[position + 1] ?? end, end);
      if (stop <= start) return;
      const block = body.slice(start, stop).join(' ');

      const percentMatch = block.match(/(\d+(?:\.\d+)?)\s*%/);
      const amountMatch = block.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
      const percentage = percentMatch ? Number(percentMatch[1]) : null;
      const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : null;
      if (percentage === null && amount === null) return;

      // La etiqueta es todo lo que va antes del descriptor de importe.
      const label = block
        .split(/\s(?=(?:fixed\s+amount|\d+(?:\.\d+)?\s*%|\$))/i)[0]
        .replace(/[\s:–-]+$/, '')
        .trim();

      items.push({
        label: label || `Payment ${items.length + 1}`,
        percentage: Number.isFinite(percentage as number) ? percentage : null,
        amount: Number.isFinite(amount as number) ? amount : null,
        basis: /of\s+remaining\s+balance/i.test(block) ? 'remaining-balance' : 'total',
      });
    });

    if (items.length < 2) return null;

    const totalLine = totalIndex >= 0 ? body.slice(totalIndex, totalIndex + 3).join(' ') : '';
    const totalPercentMatch = totalLine.match(/(\d+(?:\.\d+)?)\s*%/);
    const totalAmountMatch = totalLine.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
    const percentages = items
      .map((item) => item.percentage)
      .filter((value): value is number => value !== null);

    return this.withBasis({
      items,
      totalPercentage: totalPercentMatch
        ? Number(totalPercentMatch[1])
        : percentages.length
          ? percentages.reduce((sum, value) => sum + value, 0)
          : null,
      totalAmount: totalAmountMatch
        ? Number(totalAmountMatch[1].replace(/,/g, ''))
        : this.sumAmounts(items),
    });
  }

  private parseStackedRows(body: string[]): ParsedSchedule | null {
    const percentRows = body
      .map((line, index) => ({ line, index, percentage: this.parsePercentage(line) }))
      .filter((row): row is { line: string; index: number; percentage: number } => row.percentage !== null);
    if (!percentRows.length) return null;

    const moneyRows = body
      .map((line, index) => ({ line, index, amount: this.parseMoney(line) }))
      .filter((row): row is { line: string; index: number; amount: number } => row.amount !== null);
    const orderedAmounts = moneyRows.map((row) => row.amount);
    const items: PaymentScheduleItem[] = [];

    percentRows.forEach((row, rowIndex) => {
      const nextPercentIndex = percentRows[rowIndex + 1]?.index ?? Number.POSITIVE_INFINITY;
      const amountAfter = moneyRows.find(
        (money) => money.index > row.index && money.index < nextPercentIndex,
      );
      const amount = amountAfter?.amount ?? orderedAmounts[rowIndex] ?? null;
      const label = this.findLabel(body, row.index, percentRows[rowIndex - 1]?.index);
      if (/^total$/i.test(label)) return;
      items.push({
        label: label || `Payment ${items.length + 1}`,
        percentage: row.percentage,
        amount,
      });
    });

    if (!items.length) return null;
    const totalRow = percentRows.find((row) => /^total\b/i.test(row.line));
    const percentages = items
      .map((item) => item.percentage)
      .filter((value): value is number => value !== null);
    const totalPercentage =
      totalRow?.percentage ?? percentages.reduce((sum, value) => sum + value, 0);
    const totalAmount = this.findTotalAmount(body, totalRow?.index) ?? this.sumAmounts(items);

    return this.withBasis({
      items,
      totalPercentage,
      totalAmount,
    });
  }

  /**
   * Un cronograma es "remaining-balance" en cuanto un hito lo sea: mezclar
   * bases y presentarlas como si fueran del total es lo que hace que los
   * montos no cuadren con el estimate.
   */
  private withBasis(schedule: Omit<ParsedSchedule, 'basis'>): ParsedSchedule {
    const basis: PaymentScheduleBasis = schedule.items.some(
      (item) => item.basis === 'remaining-balance',
    )
      ? 'remaining-balance'
      : 'total';
    return { ...schedule, basis };
  }

  private buildCacheKey(realmId: string, projectNumbers: string[]): string {
    return `qbo:payment-schedules:${realmId}:${[...projectNumbers].sort().join(',')}`;
  }

  private indexTransactions(
    estimates: QboTransaction[],
    invoices: QboTransaction[],
    jobIds: string[],
    jobMap: Record<string, string>,
  ): Map<string, { projectNumber: string; entityType: 'Estimate' | 'Invoice'; entityId: string }> {
    const projectByJobId = new Map(
      Object.entries(jobMap).map(([projectNumber, jobId]) => [String(jobId), projectNumber]),
    );
    const validJobIds = new Set(jobIds.map(String));
    const result = new Map<string, { projectNumber: string; entityType: 'Estimate' | 'Invoice'; entityId: string }>();

    for (const [entityType, rows] of [
      ['Estimate', estimates],
      ['Invoice', invoices],
    ] as const) {
      for (const row of rows) {
        const entityId = this.helpers.stringValue(row.Id);
        const customerRef = this.helpers.asRecord(row.CustomerRef);
        const customerId = this.helpers.stringValue(customerRef['value'] ?? row.CustomerRef);
        const projectNumber = validJobIds.has(customerId) ? projectByJobId.get(customerId) : undefined;
        if (!entityId || !projectNumber) continue;
        result.set(`${entityType}:${entityId}`, { projectNumber, entityType, entityId });
      }
    }
    return result;
  }

  private buildCandidates(
    attachments: Record<string, unknown>[],
    projectByTransaction: Map<string, { projectNumber: string; entityType: 'Estimate' | 'Invoice'; entityId: string }>,
    jobMap: Record<string, string>,
    knownProjectNumbers: string[],
  ): Candidate[] {
    const projectByJobId = new Map(
      Object.entries(jobMap).map(([projectNumber, jobId]) => [String(jobId), projectNumber]),
    );
    const known = new Set(knownProjectNumbers);
    const candidates: Candidate[] = [];
    const seen = new Set<string>();

    const push = (candidate: Candidate, fallbackKey: string) => {
      const key = `${candidate.projectNumber}:${fallbackKey}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push(candidate);
    };

    for (const attachment of attachments) {
      const fileName = this.helpers.stringValue(attachment['FileName']);
      const contentType = this.helpers.stringValue(attachment['ContentType']).toLowerCase();
      if (contentType !== PDF_CONTENT_TYPE && !/\.pdf$/i.test(fileName)) continue;
      const attachmentId = this.helpers.stringValue(attachment['Id']);
      const dedupeKey = attachmentId || fileName;
      let linked = false;

      for (const ref of this.helpers.extractAttachableRefs(attachment)) {
        if (ref.entityType === 'Estimate' || ref.entityType === 'Invoice') {
          const transaction = projectByTransaction.get(`${ref.entityType}:${ref.entityId}`);
          if (!transaction) continue;
          linked = true;
          push(
            {
              ...transaction,
              attachment,
              matchedBy: ref.entityType === 'Estimate' ? 'estimate' : 'invoice',
              rank: ref.entityType === 'Estimate' ? RANK_ESTIMATE : RANK_INVOICE,
            },
            dedupeKey,
          );
          continue;
        }

        // Adjunto colgado del job en sí, no de una transacción suya.
        if (ref.entityType === 'Customer') {
          const projectNumber = projectByJobId.get(ref.entityId);
          if (!projectNumber) continue;
          linked = true;
          push(
            {
              projectNumber,
              entityType: 'Customer',
              entityId: ref.entityId,
              matchedBy: 'customer',
              attachment,
              rank: RANK_CUSTOMER,
            },
            dedupeKey,
          );
        }
      }

      if (linked) continue;

      // Sin vínculo utilizable: último recurso, el número en el nombre.
      for (const match of fileName.matchAll(PROJECT_NUMBER_IN_NAME)) {
        const projectNumber = match[1];
        if (!known.has(projectNumber)) continue;
        push(
          {
            projectNumber,
            entityType: null,
            entityId: null,
            matchedBy: 'file-name',
            attachment,
            rank: RANK_FILENAME,
          },
          dedupeKey,
        );
      }
    }

    candidates.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.projectNumber.localeCompare(b.projectNumber);
    });

    // Cada candidato cuesta una descarga y un parseo de PDF, y todo esto corre
    // dentro del presupuesto de 25s de findAllFinancials. Se conservan solo los
    // mejor rankeados por proyecto: si esos no traen la tabla, los peores
    // tampoco la van a traer.
    const perProject = new Map<string, number>();
    return candidates.filter((candidate) => {
      const used = perProject.get(candidate.projectNumber) ?? 0;
      if (used >= MAX_CANDIDATES_PER_PROJECT) return false;
      perProject.set(candidate.projectNumber, used + 1);
      return true;
    });
  }

  private async readCandidate(
    realmId: string,
    candidate: Candidate,
  ): Promise<{ projectNumber: string; value: PaymentSchedule } | null> {
    try {
      const attachmentId = this.helpers.stringValue(candidate.attachment['Id']);
      let downloadUrl = this.helpers.stringValue(candidate.attachment['TempDownloadUri']);
      if (!downloadUrl && attachmentId) {
        const raw = await this.apiService.getById(realmId, 'attachable', attachmentId);
        const attachable = this.apiService.unwrapQboEntity(raw, 'Attachable');
        downloadUrl = this.helpers.stringValue(attachable['TempDownloadUri']);
      }
      if (!downloadUrl) return null;

      const response = await axios.get<ArrayBuffer>(downloadUrl, {
        responseType: 'arraybuffer',
        timeout: PDF_DOWNLOAD_TIMEOUT_MS,
        maxContentLength: PDF_MAX_BYTES,
        maxBodyLength: PDF_MAX_BYTES,
      });
      const parsed = this.parseText((await pdfParse(Buffer.from(response.data))).text);
      if (!parsed) return null;

      return {
        projectNumber: candidate.projectNumber,
        value: {
          ...parsed,
          source: {
            attachmentId,
            fileName: this.helpers.stringValue(candidate.attachment['FileName']),
            entityType: candidate.entityType,
            entityId: candidate.entityId,
            matchedBy: candidate.matchedBy,
          },
        },
      };
    } catch (error) {
      this.logger.debug(
        `Payment Schedule PDF skipped for ${candidate.projectNumber}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private findLabel(lines: string[], percentIndex: number, previousPercentIndex?: number): string {
    const start = previousPercentIndex === undefined ? 0 : previousPercentIndex + 1;
    return lines
      .slice(start, percentIndex)
      .filter((line) => !this.parseMoney(line) && this.parsePercentage(line) === null)
      .filter((line) => !/^(payment schedule|amount|percentage|description)$/i.test(line))
      .join(' ')
      .replace(/\b(total|payment instructions)\b/gi, (match) => match)
      .trim();
  }

  private findTotalAmount(lines: string[], totalIndex?: number): number | null {
    if (totalIndex === undefined) return null;
    const money = lines
      .slice(totalIndex, totalIndex + 4)
      .map((line) => this.parseMoney(line))
      .find((value): value is number => value !== null);
    return money ?? null;
  }

  private sumAmounts(items: PaymentScheduleItem[]): number | null {
    const amounts = items.map((item) => item.amount).filter((amount): amount is number => amount !== null);
    return amounts.length ? amounts.reduce((sum, amount) => sum + amount, 0) : null;
  }

  private parsePercentage(line: string): number | null {
    const match = line.match(/^(\d+(?:\.\d+)?)\s*%$/);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  }

  private parseMoney(line: string): number | null {
    if (!/^\$?\s*-?[\d,]+(?:\.\d{2})?$/.test(line)) return null;
    const value = Number(line.replace(/[$,\s]/g, ''));
    return Number.isFinite(value) ? value : null;
  }
}
