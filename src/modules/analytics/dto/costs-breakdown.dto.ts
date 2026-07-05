export class CostCategoryDto {
  category: string;
  section: 'EXPENSES' | 'COGS';
  amount: number;
}

export class CostsBreakdownDto {
  totalCosts: number;
  totalExpenses: number;
  totalCogs: number;
  categories: CostCategoryDto[];
  period: { from: string; to: string };
}
