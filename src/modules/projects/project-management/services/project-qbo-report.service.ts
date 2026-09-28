import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../../../../entities/project.entity';
import { ResourceNotFoundException } from '../../../../common/exceptions/resource-not-found.exception';
import { QboConnection } from '../../../quickbooks/entities/qbo-connection.entity';
import { QuickbooksApiService } from '../../../quickbooks/services/core/quickbooks-api.service';
import { QboReauthorizationRequiredException } from '../../../quickbooks/exceptions/qbo-reauthorization-required.exception';
import { ProjectNotLinkedToQboException } from '../exceptions/project-not-linked-to-qbo.exception';
import {
  QboAccountingMethod,
  QboReportName,
  QboReportQueryDto,
} from '../dto/qbo-report-query.dto';

/**
 * Nombre real del reporte en QBO y si es un reporte a fecha de corte
 * (`report_date`) en vez de un reporte de rango (`start_date`/`end_date`).
 */
const QBO_REPORTS: Record<
  QboReportName,
  { qboName: string; pointInTime: boolean }
> = {
  [QboReportName.ProfitAndLossDetail]: {
    qboName: 'ProfitAndLossDetail',
    pointInTime: false,
  },
  [QboReportName.ProfitAndLoss]: { qboName: 'ProfitAndLoss', pointInTime: false },
  // QBO publica el detalle del libro mayor bajo el nombre GeneralLedger.
  [QboReportName.GeneralLedgerDetail]: {
    qboName: 'GeneralLedger',
    pointInTime: false,
  },
  [QboReportName.AgedPayables]: { qboName: 'AgedPayables', pointInTime: true },
  [QboReportName.VendorExpenses]: {
    qboName: 'VendorExpenses',
    pointInTime: false,
  },
  [QboReportName.VendorBalanceDetail]: {
    qboName: 'VendorBalanceDetail',
    pointInTime: false,
  },
  [QboReportName.CashFlow]: { qboName: 'CashFlow', pointInTime: false },
  [QboReportName.BalanceSheet]: { qboName: 'BalanceSheet', pointInTime: true },
};

@Injectable()
export class ProjectQboReportService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(QboConnection)
    private readonly connectionRepo: Repository<QboConnection>,
    private readonly api: QuickbooksApiService,
  ) {}

  /**
   * Devuelve el reporte de QuickBooks acotado al cliente vinculado al proyecto,
   * exactamente como lo entrega la API de QBO: sin parseo de filas, sin troceo
   * del rango de fechas y sin resúmenes calculados.
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
    const { qboName, pointInTime } = QBO_REPORTS[report];

    if (!pointInTime && (!query.startDate || !query.endDate)) {
      throw new BadRequestException(
        `El reporte ${report} requiere startDate y endDate.`,
      );
    }

    const realmId = await this.resolveRealmId(query.realmId);
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
      startDate: query.startDate ?? null,
      endDate: query.endDate ?? null,
      raw,
    };
  }

  private async resolveRealmId(realmId?: string): Promise<string> {
    if (realmId) return realmId;
    const [connection] = await this.connectionRepo.find({ take: 1 });
    if (!connection) throw new QboReauthorizationRequiredException('(none)');
    return connection.realmId;
  }
}
