export class CashPositionDto {
  cashPosition: number;
  cashAtEnd: number | null;
  netCash: number | null;
  period: { from: string; to: string };
}
