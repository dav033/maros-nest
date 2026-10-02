/** One client's whole lead history, as the scorecard reports it. */
export class ClientScorecardRowDto {
  contactId: number;
  contactName: string | null;
  /** The contact's company, carried along so the frontend can group by firm. */
  companyId: number | null;
  companyName: string | null;
  leadCount: number;
  wonCount: number;
  lostCount: number;
  /** Neither won nor lost, NULL status included. */
  openCount: number;
  /** wonCount + lostCount — the denominator of closeRate, so a 1-of-1 is not read as 100%. */
  decidedCount: number;
  /** Fraction 0–1 over decided leads only; null when nothing has been decided yet. */
  closeRate: number | null;
  estimatedValueTotal: number;
  estimatedValueWon: number;
  /** YYYY-MM-DD of the newest lead, or null when none of them carries a start date. */
  lastLeadDate: string | null;
}
