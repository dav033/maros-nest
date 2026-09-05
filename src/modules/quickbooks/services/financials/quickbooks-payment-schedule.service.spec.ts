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
      basis: 'total',
    });
  });

  it('does not treat unrelated percentages as a schedule', () => {
    expect(service.parseText('Invoice\nSales tax 7%\nRetention 10%')).toBeNull();
  });

  // Formato de los proposals que Maros emite hoy: la tabla no vive bajo un
  // encabezado "Payment Schedule" propio, el hito abre con "Payment No. N" y el
  // importe llega en las líneas siguientes.
  it('extracts the Payment Milestone layout, with fixed amounts and remaining-balance percentages', () => {
    const parsed = service.parseText(
      [
        'Terms and Conditions',
        'Approval of this proposal confirms acceptance of the scope, exclusions, payment schedule, and',
        'these Terms and Conditions.',
        'Payment Milestone Percentage Amount',
        'Payment No. 1 – Window Drawings, Engineering Calculations &',
        'Permit Documentation',
        'Fixed Amount $5,000.00',
        'Payment No. 2 – Contract Execution, Permit Processing & Project',
        'Mobilization',
        '35% of Remaining',
        'Balance',
        '$66,245.63',
      ].join('\n'),
    );

    expect(parsed).not.toBeNull();
    expect(parsed!.items).toEqual([
      {
        label: 'Payment No. 1 – Window Drawings, Engineering Calculations & Permit Documentation',
        percentage: null,
        amount: 5000,
        basis: 'total',
      },
      {
        label: 'Payment No. 2 – Contract Execution, Permit Processing & Project Mobilization',
        percentage: 35,
        amount: 66245.63,
        basis: 'remaining-balance',
      },
    ]);
    expect(parsed!.totalAmount).toBe(71245.63);
    // Un solo hito porcentual sobre saldo: el cronograma completo queda marcado
    // así para que la UI no presente los montos como fracción del estimate.
    expect(parsed!.basis).toBe('remaining-balance');
  });

  it('ignores a lone milestone that is not a schedule', () => {
    expect(
      service.parseText('Payment Schedule\nPayment No. 1 – Deposit\nFixed Amount $1,000.00'),
    ).toBeNull();
  });
});
