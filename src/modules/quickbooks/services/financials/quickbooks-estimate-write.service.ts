import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { QuickbooksApiService } from '../core/quickbooks-api.service';
import {
  QboNormalizedTransaction,
  QuickbooksNormalizerService,
} from '../core/quickbooks-normalizer.service';
import { QuickbooksFinancialsContextService } from './quickbooks-financials-context.service';

type QboRef = { value: string; name?: string };

/**
 * Escritura de Estimates en QuickBooks.
 *
 * El total de un Estimate en QBO se deriva de sus líneas; no se puede fijar el
 * total directamente. Para editar "el valor" desde la UI reescribimos el
 * Estimate a una única línea cuyo importe es el total deseado, preservando el
 * ItemRef existente (o resolviendo uno por defecto). Se edita el Estimate más
 * reciente del proyecto; si no hay ninguno, se crea uno nuevo.
 */
@Injectable()
export class QuickbooksEstimateWriteService {
  private readonly logger = new Logger(QuickbooksEstimateWriteService.name);

  constructor(
    private readonly apiService: QuickbooksApiService,
    private readonly normalizer: QuickbooksNormalizerService,
    private readonly contextService: QuickbooksFinancialsContextService,
  ) {}

  /**
   * Fija el total del proyecto (suma de todos sus estimates) en `total`,
   * sincronizándolo con QuickBooks. Ajusta el estimate más reciente para que la
   * suma total coincida con `total`. Devuelve el Estimate editado ya normalizado.
   */
  async setProjectEstimateTotal(
    projectNumber: string,
    total: number,
    realmId?: string,
  ): Promise<QboNormalizedTransaction> {
    if (!Number.isFinite(total) || total < 0) {
      throw new BadRequestException(
        'El monto del estimate debe ser un número mayor o igual a 0.',
      );
    }

    const effectiveRealmId =
      realmId ?? (await this.contextService.resolveDefaultRealmId());
    const { jobId } = await this.contextService.resolveSingleJob(
      projectNumber,
      effectiveRealmId,
    );
    if (!jobId) {
      throw new BadRequestException(
        `El proyecto ${projectNumber} no está vinculado a un cliente/job en QuickBooks, no se puede editar el estimate.`,
      );
    }

    // El número que el usuario escribe es SIEMPRE el total del proyecto que ve
    // en la UI (que es la suma de todos los estimates). Para no confundirlo,
    // editamos el estimate más reciente de modo que la suma total quede igual a
    // `total`: nuevoImporteMasReciente = total - (suma de los demás estimates).
    const estimates = await this.fetchEstimatesRawSorted(
      effectiveRealmId,
      jobId,
    );
    const mostRecent = estimates[0] ?? null;
    const others = estimates.slice(1);
    const otherSum = others.reduce(
      (sum, e) => sum + (Number(e['TotalAmt']) || 0),
      0,
    );
    const targetForMostRecent = Math.round((total - otherSum) * 100) / 100;

    if (targetForMostRecent < 0) {
      throw new BadRequestException(
        `No se puede fijar el total del estimate en ${total}: el proyecto ya tiene otros estimates en QuickBooks que suman ${otherSum}. Ingresa un total mayor o ajusta esos estimates en QuickBooks.`,
      );
    }

    const body = mostRecent
      ? this.buildUpdateBody(
          mostRecent,
          targetForMostRecent,
          await this.resolveItemRef(mostRecent, effectiveRealmId),
        )
      : this.buildCreateBody(
          jobId,
          total,
          await this.resolveItemRef(null, effectiveRealmId),
        );

    const response = await this.apiService.mutateEntity(
      effectiveRealmId,
      'estimate',
      body,
    );
    const raw = this.apiService.unwrapQboEntity(response, 'Estimate');
    this.logger.log(
      `Estimate ${mostRecent ? 'updated' : 'created'} for project ${projectNumber} (job ${jobId}) → project total ${total} (${others.length} other estimate(s) summing ${otherSum})`,
    );
    return this.normalizer.normalizeEstimate(raw);
  }

  /** Devuelve los estimates del job en crudo, ordenados del más reciente al más antiguo. */
  private async fetchEstimatesRawSorted(
    realmId: string,
    jobId: string,
  ): Promise<Record<string, unknown>[]> {
    const resp = (await this.apiService.query(
      realmId,
      `SELECT * FROM Estimate WHERE CustomerRef IN ('${this.apiService.escapeQboString(jobId)}') STARTPOSITION 1 MAXRESULTS 1000`,
    )) as { QueryResponse?: { Estimate?: Record<string, unknown>[] } };

    const estimates = resp?.QueryResponse?.Estimate ?? [];
    return [...estimates].sort(
      (a, b) => this.estimateSortKey(b) - this.estimateSortKey(a),
    );
  }

  /** Clave de orden: más reciente primero (LastUpdatedTime, luego TxnDate, luego Id). */
  private estimateSortKey(estimate: Record<string, unknown>): number {
    const meta = estimate['MetaData'] as
      | { LastUpdatedTime?: string; CreateTime?: string }
      | undefined;
    const lastUpdated = meta?.LastUpdatedTime ?? meta?.CreateTime;
    if (lastUpdated) {
      const t = Date.parse(lastUpdated);
      if (!Number.isNaN(t)) return t;
    }
    const txnDate = estimate['TxnDate'];
    if (typeof txnDate === 'string') {
      const t = Date.parse(txnDate);
      if (!Number.isNaN(t)) return t;
    }
    const id = Number(estimate['Id']);
    return Number.isFinite(id) ? id : 0;
  }

  private buildUpdateBody(
    existing: Record<string, unknown>,
    total: number,
    itemRef: QboRef,
  ): Record<string, unknown> {
    return {
      Id: existing['Id'],
      SyncToken: existing['SyncToken'],
      sparse: true,
      CustomerRef: existing['CustomerRef'],
      Line: [this.buildSingleAmountLine(total, itemRef)],
    };
  }

  private buildCreateBody(
    jobId: string,
    total: number,
    itemRef: QboRef,
  ): Record<string, unknown> {
    return {
      CustomerRef: { value: jobId },
      Line: [this.buildSingleAmountLine(total, itemRef)],
    };
  }

  private buildSingleAmountLine(
    total: number,
    itemRef: QboRef,
  ): Record<string, unknown> {
    return {
      DetailType: 'SalesItemLineDetail',
      Amount: total,
      SalesItemLineDetail: {
        ItemRef: itemRef,
        Qty: 1,
        UnitPrice: total,
      },
    };
  }

  /**
   * Determina qué ItemRef usar en la única línea: el del Estimate existente si
   * lo tiene, o un item por defecto de QBO (preferentemente de tipo Service).
   */
  private async resolveItemRef(
    existing: Record<string, unknown> | null,
    realmId: string,
  ): Promise<QboRef> {
    const fromExisting = existing
      ? this.extractItemRef(existing)
      : null;
    if (fromExisting) return fromExisting;

    const defaultItem = await this.resolveDefaultItemRef(realmId);
    if (!defaultItem) {
      throw new BadRequestException(
        'No se encontró ningún producto/servicio activo en QuickBooks para crear la línea del estimate.',
      );
    }
    return defaultItem;
  }

  private extractItemRef(
    estimate: Record<string, unknown>,
  ): QboRef | null {
    const lines = Array.isArray(estimate['Line'])
      ? (estimate['Line'] as Record<string, unknown>[])
      : [];
    for (const line of lines) {
      if (line?.['DetailType'] !== 'SalesItemLineDetail') continue;
      const detail = line['SalesItemLineDetail'] as
        | { ItemRef?: QboRef }
        | undefined;
      const ref = detail?.ItemRef;
      if (ref?.value) return { value: ref.value, name: ref.name };
    }
    return null;
  }

  private async resolveDefaultItemRef(
    realmId: string,
  ): Promise<QboRef | null> {
    const queries = [
      `SELECT Id, Name FROM Item WHERE Type = 'Service' AND Active = true STARTPOSITION 1 MAXRESULTS 1`,
      `SELECT Id, Name FROM Item WHERE Active = true STARTPOSITION 1 MAXRESULTS 1`,
    ];
    for (const query of queries) {
      const resp = (await this.apiService.query(realmId, query)) as {
        QueryResponse?: { Item?: { Id?: string; Name?: string }[] };
      };
      const item = resp?.QueryResponse?.Item?.[0];
      if (item?.Id) {
        return { value: item.Id, name: item.Name };
      }
    }
    return null;
  }
}
