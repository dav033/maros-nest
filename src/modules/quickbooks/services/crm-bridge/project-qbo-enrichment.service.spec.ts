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
      getPaymentSchedulesByProjects: jest.fn().mockResolvedValue(new Map()),
    };
    const jobCosting = {
      getProjectJobCostSummaries: jest
        .fn()
        .mockResolvedValue(new Map([['P-1', { totalJobCost: 47, cashOutPaid: 30 }]])),
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
      financial: { totalJobCost: 47, grossProfit: 43, cashOutPaid: 30 },
      qbo: { totalJobCost: 47, grossProfit: 43, cashOutPaid: 30 },
    });
  });
});
