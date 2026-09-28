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
    if (!project.qboCustomerId) {
      throw new ProjectNotLinkedToQboException(leadNumber ?? `#${projectId}`);
    }

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
    const raw = await this.api.report(realmId, qboName, {
      accounting_method: accountingMethod,
      customer: project.qboCustomerId,
      ...(pointInTime
        ? { report_date: query.endDate }
        : { start_date: query.startDate, end_date: query.endDate }),
    });

    return {
      projectId: project.id,
      leadNumber,
      qboCustomerId: project.qboCustomerId,
      report,
      accountingMethod,
      scope,
      startDate: query.startDate ?? null,
      endDate: query.endDate ?? null,
      raw,
    };
  }
}
