import { QuickbooksPaymentScheduleService } from './quickbooks-payment-schedule.service';

describe('QuickbooksPaymentScheduleService', () => {
  const service = new QuickbooksPaymentScheduleService({} as never, {} as never);

  it('extracts inline Payment Schedule rows from a QBO PDF text layer', () => {
    expect(
      service.parseText(
        [
          'Payment Schedule',
          'Total Contract Amount: $42,815.29',
          'Payment Stage Percentage Amount (USD)',
          'Initial Payment (Due at Project Start) 30% $12,844.59',
          'Final Payment (Due Upon Completion) 70% $29,970.70',
          'Total 100% $42,815.29',
          'Payment Instructions:',
        ].join('\n'),
      ),
    ).toEqual({
      items: [
        { label: 'Initial Payment (Due at Project Start)', percentage: 30, amount: 12844.59 },
        { label: 'Final Payment (Due Upon Completion)', percentage: 70, amount: 29970.7 },
      ],
      totalPercentage: 100,
      totalAmount: 42815.29,
    });
  });

  it('does not treat unrelated percentages as a schedule', () => {
    expect(service.parseText('Invoice\nSales tax 7%\nRetention 10%')).toBeNull();
  });
});
