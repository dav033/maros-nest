export class ExpensesSummaryDto {
  totalExpenses: number;
  totalCogs: number;
  period: { from: string; to: string };
}
