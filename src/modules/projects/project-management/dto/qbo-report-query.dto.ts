import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum QboReportName {
  ProfitAndLossDetail = 'ProfitAndLossDetail',
  ProfitAndLoss = 'ProfitAndLoss',
  GeneralLedgerDetail = 'GeneralLedgerDetail',
  AgedPayables = 'AgedPayables',
  VendorExpenses = 'VendorExpenses',
  VendorBalanceDetail = 'VendorBalanceDetail',
  CashFlow = 'CashFlow',
  BalanceSheet = 'BalanceSheet',
}

export enum QboAccountingMethod {
  Cash = 'Cash',
  Accrual = 'Accrual',
}

export class QboReportQueryDto {
  @ApiPropertyOptional({
    enum: QboReportName,
    default: QboReportName.ProfitAndLossDetail,
    description: 'Reporte de QuickBooks a consultar',
  })
  @IsOptional()
  @IsEnum(QboReportName)
  report?: QboReportName;

  @ApiPropertyOptional({
    enum: QboAccountingMethod,
    default: QboAccountingMethod.Accrual,
    description: 'Método contable que QuickBooks usa para calcular el reporte',
  })
  @IsOptional()
  @IsEnum(QboAccountingMethod)
  accountingMethod?: QboAccountingMethod;

  @ApiPropertyOptional({
    description:
      'Inicio del rango (YYYY-MM-DD). Obligatorio salvo en reportes a una fecha de corte (AgedPayables, BalanceSheet)',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: '"startDate" must be in YYYY-MM-DD format',
  })
  startDate?: string;

  @ApiPropertyOptional({
    description:
      'Fin del rango (YYYY-MM-DD). En reportes a una fecha de corte se envía como report_date',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: '"endDate" must be in YYYY-MM-DD format',
  })
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Realm de QuickBooks; por defecto se usa la conexión activa',
  })
  @IsOptional()
  @IsString()
  realmId?: string;
}
