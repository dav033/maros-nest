export class RevenueTrendDto {
  month: string;
  revenue: number;
}

export class ProjectsStatusBucketDto {
  status: string;
  count: number;
}

export class TopClientDto {
  jobId: string;
  customerName: string;
  projectNumber: string | null;
  totalInvoiced: number;
  totalPaid: number;
  totalOutstanding: number;
  invoiceCount: number;
}
