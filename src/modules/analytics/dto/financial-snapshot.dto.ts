export class FinancialSnapshotDto {
  projectCount: number;
  estimatedTotal: number;
  invoicedTotal: number;
  paidTotal: number;
  outstandingTotal: number;
}

export class AgingBucketDto {
  label: string;
  count: number;
  totalBalance: number;
}
