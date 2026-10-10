import { ProjectQboEnrichmentService } from './project-qbo-enrichment.service';

describe('ProjectQboEnrichmentService job costs', () => {
  it('adds batch job cost and gross profit to project financials when requested', async () => {
    const financial = {
      projectNumber: 'P-1',
      found: true,
      estimatedAmount: 120,
      estimateCount: 1,
      invoicedAmount: 90,
      invoiceCount: 1,
      paidAmount: 75,
      outstandingAmount: 15,
      paidPercentage: 83.33,
      estimateVsInvoicedDelta: 30,
    };
    const financials = {
      getProjectFinancials: jest.fn().mockResolvedValue([financial]),
      getPaymentsByProjects: jest
        .fn()
        .mockResolvedValue(new Map([['P-1', []]])),
      getCachedPaymentSchedulesByProjects: jest.fn().mockResolvedValue(new Map()),
    };
    const jobCosting = {
      getProjectJobCostSummaries: jest
        .fn()
        .mockResolvedValue(new Map([['P-1', { cashOutPaid: 30, totalJobCost: 47 }]])),
    };
    const service = new ProjectQboEnrichmentService(
      financials as never,
      jobCosting as never,
    );
    const projects = [{ lead: { leadNumber: 'P-1' } }];

    await service.enrichProjectsSummary(projects, { includeJobCosts: true });

    expect(jobCosting.getProjectJobCostSummaries).toHaveBeenCalledWith(
      ['P-1'],
      undefined,
    );
    expect(projects[0]).toMatchObject({
      financial: {
        cashJobCost: 30,
        cashProfit: 45,
        cashBacklog: 45,
        totalJobCost: 47,
        grossProfit: 43,
      },
      qbo: {
        cashJobCost: 30,
        cashProfit: 45,
        cashBacklog: 45,
        totalJobCost: 47,
        grossProfit: 43,
      },
    });
  });

  it('marks the payment schedule as pending instead of passing it off as absent', async () => {
    const financials = {
      getProjectFinancials: jest.fn().mockResolvedValue([
        { projectNumber: 'P-1', found: true, invoicedAmount: 90 },
      ]),
      getPaymentsByProjects: jest.fn().mockResolvedValue(new Map()),
      // `null` = los PDF aun no se han leido.
      getCachedPaymentSchedulesByProjects: jest.fn().mockResolvedValue(null),
    };
    const service = new ProjectQboEnrichmentService(
      financials as never,
      { getProjectJobCostSummaries: jest.fn() } as never,
    );
    const projects = [{ lead: { leadNumber: 'P-1' } }];

    await service.enrichProjectsSummary(projects);

    const enriched = projects[0] as { financial?: Record<string, unknown> };
    expect(enriched.financial).toMatchObject({ paymentSchedulePending: true });
    expect(enriched.financial).not.toHaveProperty('paymentSchedule');
  });
});
