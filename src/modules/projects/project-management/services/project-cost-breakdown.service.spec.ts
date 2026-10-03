import type { Repository } from 'typeorm';
import { Project } from '../../../../entities/project.entity';
import { Lead } from '../../../../entities/lead.entity';
import { QuickbooksJobCostingService } from '../../../quickbooks/services/job-costing/quickbooks-job-costing.service';
import { ProjectCostBreakdownService } from './project-cost-breakdown.service';

/**
 * Comprobado contra el job 032P-0825 (cliente 472) llamando al endpoint real:
 * material 105.600,23 y subcontratistas 78.840,63, que son exactamente las dos
 * cifras del Profit and Loss en base caja de QuickBooks, sobre 190.586,43 de
 * coste pagado. Los 6.145,57 restantes son alquiler de equipo, permisos, planos
 * y oficina — cuentas que no entran en ninguna de las dos categorias.
 */
const vendor = (name: string, paid: number, count = 1) => ({
  id: name,
  name,
  cashOutPaid: paid,
  openAp: 0,
  committedPo: 0,
  vendorCredits: 0,
  adjustedCosts: 0,
  totalJobCost: paid,
  transactionCount: count,
});

const bucket = (
  name: string,
  paid: number,
  vendors: ReturnType<typeof vendor>[] = [],
) => ({
  id: name,
  name,
  cashOutPaid: paid,
  openAp: 0,
  committedPo: 0,
  vendorCredits: 0,
  adjustedCosts: 0,
  totalJobCost: paid,
  transactionCount: vendors.length,
  vendors,
});

function harness(
  opts: {
    project?: Partial<Project> | null;
    expenseBreakdown?: ReturnType<typeof bucket>[];
    cashOutPaid?: number;
    totalJobCost?: number;
  } = {},
) {
  const project =
    opts.project === null
      ? null
      : Object.assign(new Project(), {
          id: 77,
          lead: Object.assign(new Lead(), { id: 11, leadNumber: '032P-0825' }),
          ...opts.project,
        });

  const getProjectJobCostSummary = jest.fn().mockResolvedValue({
    project: {
      projectNumber: '032P-0825',
      qboCustomerId: '472',
      customerName: '032P-0825',
      foundInQuickBooks: true,
      crmProjectId: 77,
      crmLeadId: 11,
    },
    summary: {
      cashOutPaid: opts.cashOutPaid ?? 190586.43,
      totalJobCost: opts.totalJobCost ?? 190814.28,
    },
    expenseBreakdown: opts.expenseBreakdown ?? [],
  });

  const service = new ProjectCostBreakdownService(
    { findOne: jest.fn().mockResolvedValue(project) } as unknown as Repository<Project>,
    { getProjectJobCostSummary } as unknown as QuickbooksJobCostingService,
  );
  return { service, getProjectJobCostSummary };
}

describe('ProjectCostBreakdownService', () => {
  it('picks the materials and subcontractors accounts by name', async () => {
    const { service } = harness({
      expenseBreakdown: [
        bucket('Construction Materials Costs', 105600.23, [
          vendor('BOND PLUMBING SUPPLY, INC.', 44411.68, 31),
        ]),
        bucket('53600 Subcontractors Expense', 78840.63, [
          vendor('MARC ANTHONYS PLUMBING SERVICES LLC', 40000, 5),
        ]),
        bucket('L. LOZANO (6750) - 1', 6145.57),
      ],
    });

    const result = await service.getBreakdown(77);

    const byKey = Object.fromEntries(result.categories.map((c) => [c.key, c]));
    expect(byKey.material.paid).toBe(105600.23);
    expect(byKey.subcontractor.paid).toBe(78840.63);
    expect(byKey.material.vendors[0].name).toBe('BOND PLUMBING SUPPLY, INC.');
  });

  /**
   * El resto tiene que salir a la vista. Ensenar solo las dos categorias daria
   * dos cifras que no suman el coste del proyecto, y nadie sabria por que
   * faltan 6.145,57.
   */
  it('reports what falls outside the two categories', async () => {
    const { service } = harness({
      expenseBreakdown: [
        bucket('Construction Materials Costs', 105600.23),
        bucket('53600 Subcontractors Expense', 78840.63),
      ],
    });

    const result = await service.getBreakdown(77);

    expect(result.totalPaid).toBe(190586.43);
    expect(result.otherPaid).toBe(6145.57);
  });

  it('compares what was paid against the forecast', async () => {
    const { service } = harness({
      project: { forecastMaterialCost: '100000.00', forecastSubcontractorCost: null },
      expenseBreakdown: [bucket('Construction Materials Costs', 105600.23)],
    });

    const result = await service.getBreakdown(77);

    const byKey = Object.fromEntries(result.categories.map((c) => [c.key, c]));
    expect(byKey.material.forecast).toBe(100000);
    expect(byKey.material.overrun).toBe(5600.23);
    // Sin pronostico no hay desvio que calcular: 0 diria "va justo".
    expect(byKey.subcontractor.forecast).toBeNull();
    expect(byKey.subcontractor.overrun).toBeNull();
  });

  it('merges a vendor that appears in two accounts of the same category', async () => {
    const { service } = harness({
      expenseBreakdown: [
        bucket('Construction Materials Costs', 1000, [vendor('BOND', 1000, 2)]),
        bucket('50400 Construction Materials - imported', 500, [vendor('BOND', 500, 1)]),
      ],
    });

    const result = await service.getBreakdown(77);

    const material = result.categories.find((c) => c.key === 'material');
    expect(material?.paid).toBe(1500);
    expect(material?.vendors).toHaveLength(1);
    expect(material?.vendors[0]).toMatchObject({ paid: 1500, transactionCount: 3 });
  });

  /** Un proyecto sin cifras no es un error: es una categoria en cero sin pronostico. */
  it('answers with empty categories when QuickBooks has nothing', async () => {
    const { service } = harness({ expenseBreakdown: [], cashOutPaid: 0, totalJobCost: 0 });

    const result = await service.getBreakdown(77);

    expect(result.categories.map((c) => c.paid)).toEqual([0, 0]);
    expect(result.categories.map((c) => c.accountName)).toEqual([null, null]);
    expect(result.otherPaid).toBe(0);
  });

  it('asks QuickBooks for neither attachments nor reports', async () => {
    const { service, getProjectJobCostSummary } = harness();

    await service.getBreakdown(77);

    expect(getProjectJobCostSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        projectNumber: '032P-0825',
        includeAttachments: false,
        includeReports: false,
      }),
    );
  });

  it('404s on a project that does not exist', async () => {
    const { service } = harness({ project: null });

    await expect(service.getBreakdown(999)).rejects.toThrow(/not found/i);
  });
});
