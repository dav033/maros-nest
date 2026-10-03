import { Project } from '../../../../entities/project.entity';
import { Lead } from '../../../../entities/lead.entity';
import { QboReportName } from '../dto/qbo-report-query.dto';
import { ProjectQboReportService } from './project-qbo-report.service';

/**
 * Lo que rompia el boton "Llevame al reporte": el servicio solo miraba
 * `qbo_customer_id`, que en produccion estaba vacio en los 109 proyectos,
 * mientras el resto de la ficha resolvia el cliente por numero de proyecto.
 */
describe('ProjectQboReportService', () => {
  const RANGE = { startDate: '2025-01-01', endDate: '2025-12-31' };

  function build(project: Project | null, jobMap: Record<string, string> = {}) {
    const report = jest.fn().mockResolvedValue({ Header: { ReportName: 'ProfitAndLossDetail' } });
    const getProjectJobIds = jest.fn().mockResolvedValue(jobMap);
    const service = new ProjectQboReportService(
      { findOne: jest.fn().mockResolvedValue(project) } as never,
      { report } as never,
      {
        getDefaultRealmId: jest.fn().mockResolvedValue('realm-1'),
        getProjectJobIds,
      } as never,
    );
    return { service, report, getProjectJobIds };
  }

  function projectWithNumber(leadNumber: string | null, qboCustomerId?: string | null) {
    return Object.assign(new Project(), {
      id: 42,
      qboCustomerId: qboCustomerId ?? null,
      lead: leadNumber
        ? Object.assign(new Lead(), { id: 7, leadNumber })
        : undefined,
    });
  }

  /**
   * Comprobado contra QuickBooks pidiendo cada reporte para dos proyectos con
   * jobs distintos (472 y 241): AgedPayables y VendorBalanceDetail devuelven
   * respuesta identica —el mismo TOTAL y los mismos 15 proveedores— asi que son
   * cifras de toda la empresa. AgedPayables estaba declarado como 'project', de
   * modo que la pantalla ensenaba la deuda de la empresa entera como si fuera
   * del proyecto y sin el aviso de alcance.
   */
  it.each([
    [QboReportName.AgedPayables, 'company'],
    [QboReportName.VendorBalanceDetail, 'company'],
    [QboReportName.ProfitAndLoss, 'project'],
    [QboReportName.ProfitAndLossDetail, 'project'],
    [QboReportName.GeneralLedgerDetail, 'project'],
    [QboReportName.VendorExpenses, 'project'],
    [QboReportName.CashFlow, 'project'],
    [QboReportName.BalanceSheet, 'project'],
  ])('declares %s as %s scope', async (report, scope) => {
    const { service } = build(projectWithNumber('097-0726', '512'));

    const result = await service.getProjectReport(42, { report, ...RANGE } as never);

    expect(result.scope).toBe(scope);
  });

  it('uses the stored link when the project has one', async () => {
    const { service, report, getProjectJobIds } = build(
      projectWithNumber('097-0726', '512'),
      { '097-0726': '999' },
    );

    const result = await service.getProjectReport(42, {
      report: QboReportName.ProfitAndLossDetail,
      ...RANGE,
    } as never);

    expect(result).toMatchObject({ qboCustomerId: '512', linkSource: 'stored' });
    expect(getProjectJobIds).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith(
      'realm-1',
      'ProfitAndLossDetail',
      expect.objectContaining({ customer: '512' }),
    );
  });

  it('falls back to the QuickBooks job that carries the project number', async () => {
    const { service, report, getProjectJobIds } = build(projectWithNumber('097-0726'), {
      '097-0726': '318',
    });

    const result = await service.getProjectReport(42, {
      report: QboReportName.ProfitAndLossDetail,
      ...RANGE,
    } as never);

    expect(result).toMatchObject({ qboCustomerId: '318', linkSource: 'project-number' });
    expect(getProjectJobIds).toHaveBeenCalledWith(['097-0726'], 'realm-1');
    expect(report).toHaveBeenCalledWith(
      'realm-1',
      'ProfitAndLossDetail',
      expect.objectContaining({ customer: '318' }),
    );
  });

  it('does not persist the id it resolved by number', async () => {
    const project = projectWithNumber('097-0726');
    const { service } = build(project, { '097-0726': '318' });

    await service.getProjectReport(42, {
      report: QboReportName.ProfitAndLossDetail,
      ...RANGE,
    } as never);

    expect(project.qboCustomerId).toBeNull();
  });

  it('still answers 409 when neither the link nor the number resolve a job', async () => {
    const { service } = build(projectWithNumber('097-0726'), {});

    await expect(
      service.getProjectReport(42, {
        report: QboReportName.ProfitAndLossDetail,
        ...RANGE,
      } as never),
    ).rejects.toMatchObject({ code: 'PROJECT_NOT_LINKED_TO_QBO' });
  });

  it('answers 409 for a project with no lead number to match on', async () => {
    const { service, getProjectJobIds } = build(projectWithNumber(null));

    await expect(
      service.getProjectReport(42, {
        report: QboReportName.ProfitAndLossDetail,
        ...RANGE,
      } as never),
    ).rejects.toMatchObject({ code: 'PROJECT_NOT_LINKED_TO_QBO' });
    expect(getProjectJobIds).not.toHaveBeenCalled();
  });

  it('404s before touching QuickBooks when the project does not exist', async () => {
    const { service, report } = build(null);

    await expect(
      service.getProjectReport(42, {
        report: QboReportName.ProfitAndLossDetail,
        ...RANGE,
      } as never),
    ).rejects.toThrow(/Project not found/);
    expect(report).not.toHaveBeenCalled();
  });
});
