import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../../../../entities/project.entity';
import { ResourceNotFoundException } from '../../../../common/exceptions/resource-not-found.exception';
import { QuickbooksApiService } from '../../../quickbooks/services/core/quickbooks-api.service';
import { QuickbooksFinancialsService } from '../../../quickbooks/services/financials/quickbooks-financials.service';
import { resolveRealmIdOrDefault } from '../../../quickbooks/services/core/quickbooks-realm.utils';
import { ProjectNotLinkedToQboException } from '../exceptions/project-not-linked-to-qbo.exception';
import {
  QboAccountingMethod,
  QboReportName,
  QboReportQueryDto,
} from '../dto/qbo-report-query.dto';

/**
 * Nombre real del reporte en QBO, si es un reporte a fecha de corte
 * (`report_date`) en vez de un reporte de rango (`start_date`/`end_date`), y el
 * alcance real de las cifras que devuelve.
 *
 * `scope` sale de si la documentación pública de la API de Intuit lista el
 * parámetro `customer` para ese reporte: ProfitAndLoss, ProfitAndLossDetail,
 * GeneralLedger, AgedPayables, VendorExpenses, CashFlow y BalanceSheet sí lo
 * listan, así que quedan acotados al cliente del proyecto. VendorBalanceDetail
 * no: solo admite `vendor` y `department`, de modo que devuelve saldos de toda
 * la empresa aunque se le mande `customer`.
 *
 * El filtro se sigue enviando en los ocho (QBO ignora los parámetros que no
 * entiende, y si algún día lo admitiera el reporte ya vendría acotado), pero la
 * respuesta declara el alcance para que la interfaz no presente cifras de la
 * empresa como si fueran del proyecto.
 */
const QBO_REPORTS: Record<
  QboReportName,
  { qboName: string; pointInTime: boolean; scope: 'project' | 'company' }
> = {
  [QboReportName.ProfitAndLossDetail]: {
    qboName: 'ProfitAndLossDetail',
    pointInTime: false,
    scope: 'project',
  },
  [QboReportName.ProfitAndLoss]: {
    qboName: 'ProfitAndLoss',
    pointInTime: false,
    scope: 'project',
  },
  // QBO publica el detalle del libro mayor bajo el nombre GeneralLedger.
  [QboReportName.GeneralLedgerDetail]: {
    qboName: 'GeneralLedger',
    pointInTime: false,
    scope: 'project',
  },
  [QboReportName.AgedPayables]: {
    qboName: 'AgedPayables',
    pointInTime: true,
    scope: 'project',
  },
  [QboReportName.VendorExpenses]: {
    qboName: 'VendorExpenses',
    pointInTime: false,
    scope: 'project',
  },
  [QboReportName.VendorBalanceDetail]: {
    qboName: 'VendorBalanceDetail',
    pointInTime: false,
    scope: 'company',
  },
  [QboReportName.CashFlow]: {
    qboName: 'CashFlow',
    pointInTime: false,
    scope: 'project',
  },
  [QboReportName.BalanceSheet]: {
    qboName: 'BalanceSheet',
    pointInTime: true,
    scope: 'project',
  },
};

@Injectable()
export class ProjectQboReportService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    private readonly api: QuickbooksApiService,
    private readonly financials: QuickbooksFinancialsService,
  ) {}

  /**
   * Devuelve el reporte de QuickBooks exactamente como lo entrega la API de
   * QBO: sin parseo de filas, sin troceo del rango de fechas y sin resúmenes
   * calculados. `scope` dice si el reporte quedó acotado al cliente del
   * proyecto o si son cifras de toda la empresa (ver QBO_REPORTS).
   */
  async getProjectReport(projectId: number, query: QboReportQueryDto) {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
      relations: ['lead'],
    });
    if (!project) {
      throw new ResourceNotFoundException(
        `Project not found with id: ${projectId}`,
      );
    }

    const leadNumber = project.lead?.leadNumber ?? null;

    const report = query.report ?? QboReportName.ProfitAndLossDetail;
    const accountingMethod = query.accountingMethod ?? QboAccountingMethod.Accrual;
    const { qboName, pointInTime, scope } = QBO_REPORTS[report];

    if (!pointInTime && (!query.startDate || !query.endDate)) {
      throw new BadRequestException(
        `El reporte ${report} requiere startDate y endDate.`,
      );
    }

    const realmId = await resolveRealmIdOrDefault(query.realmId, () =>
      this.financials.getDefaultRealmId(),
    );

    const { qboCustomerId, linkSource } = await this.resolveQboCustomerId(
      project,
      leadNumber,
      realmId,
    );

    const raw = await this.api.report(realmId, qboName, {
      accounting_method: accountingMethod,
      customer: qboCustomerId,
      ...(pointInTime
        ? { report_date: query.endDate }
        : { start_date: query.startDate, end_date: query.endDate }),
    });

    return {
      projectId: project.id,
      leadNumber,
      qboCustomerId,
      linkSource,
      report,
      accountingMethod,
      scope,
      startDate: query.startDate ?? null,
      endDate: query.endDate ?? null,
      raw,
    };
  }

  /**
   * El enlace guardado (`qbo_customer_id`) manda siempre. Cuando no lo hay se
   * resuelve el job por numero de proyecto, que es EXACTAMENTE lo que ya hacia
   * el resto de la ficha (QuickbooksFinancialsService -> resolveJobs): de ahi
   * venia la queja de que el reporte decia "no enlazado" mientras la misma
   * pantalla mostraba facturas y pagos de QuickBooks.
   *
   * La coincidencia por nombre NO se persiste aqui. El indice de jobs es un
   * heuristico sobre nombres escritos a mano (la propia pantalla de importacion
   * existe porque hay colisiones y ordenes de cambio), y un backfill silencioso
   * en produccion dejaria 109 enlaces que nadie decidio y que ademas ocuparian
   * el indice unico parcial, bloqueando la importacion correcta. Persistir es
   * un acto explicito: PUT /projects/:id/qbo-link desde la ficha, o la pantalla
   * de importacion. `linkSource` deja ver de donde salio el id de este reporte.
   */
  private async resolveQboCustomerId(
    project: Project,
    leadNumber: string | null,
    realmId: string,
  ): Promise<{ qboCustomerId: string; linkSource: 'stored' | 'project-number' }> {
    if (project.qboCustomerId) {
      return { qboCustomerId: project.qboCustomerId, linkSource: 'stored' };
    }

    if (leadNumber) {
      const jobMap = await this.financials.getProjectJobIds([leadNumber], realmId);
      const matched = jobMap[leadNumber];
      if (matched) {
        return { qboCustomerId: matched, linkSource: 'project-number' };
      }
    }

    throw new ProjectNotLinkedToQboException(leadNumber ?? `#${project.id}`);
  }
}
