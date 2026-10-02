import { LeadStatus } from '../../../common/enums/lead-status.enum';
import { ClientScorecardRowDto } from '../dto/client-scorecard.dto';

/** One lead, flattened to the columns the scorecard aggregates over. */
export interface ClientLeadRow {
  contactId: number;
  contactName: string | null;
  companyId: number | null;
  companyName: string | null;
  status: LeadStatus | null;
  /** CRM estimate; null and 0 are the same thing for a sum. */
  estimate: number | null;
  /** leads.start_date as YYYY-MM-DD, or null — the table lets it be empty. */
  startDate: string | null;
}

/**
 * Close rate over *decided* leads: won / (won + lost).
 *
 * The total number of leads is the wrong denominator. A client with 6 wins and 1 loss
 * still has three proposals out; counting those three as not-yet-wins would report 67%
 * for a relationship that closes 86% of what it answers, and would punish exactly the
 * clients with the most live pipeline.
 *
 * Returns null — never 0 — when nothing has been decided. "Zero of two closed" and
 * "nothing has come back yet" are different facts, and collapsing them into 0% is how a
 * client who simply has not answered yet gets dropped from the follow-up list.
 */
export function closeRate(wonCount: number, lostCount: number): number | null {
  const decided = wonCount + lostCount;
  if (decided <= 0) return null;
  // A fraction, not a percentage: formatting is the frontend's call. Four decimals keep
  // 6/7 distinguishable from 5/6 without printing float noise.
  return Math.round((wonCount / decided) * 10_000) / 10_000;
}

/**
 * One row per contact, aggregated in memory.
 *
 * In memory because the leads table is in the low hundreds of rows and because the rest
 * of this module already works that way (see AnalyticsPipelineService.getPipeline): the
 * arithmetic that the business reads off this view is worth more as a tested pure
 * function than as a GROUP BY nobody can unit test.
 *
 * Ordered by lead count first, won value second. The view exists to find *recurring*
 * clients, and the two rows it has to surface are opposites: the contact with seven
 * leads and six wins, and the contact with seven leads and none. Ordering by value alone
 * would show the first and bury the second at the bottom of the list, which is the half
 * of the problem that costs estimating hours.
 */
export function aggregateClientScorecard(rows: ClientLeadRow[]): ClientScorecardRowDto[] {
  const byContact = new Map<number, ClientScorecardRowDto>();

  for (const row of rows) {
    let entry = byContact.get(row.contactId);
    if (!entry) {
      entry = {
        contactId: row.contactId,
        contactName: row.contactName,
        companyId: row.companyId,
        companyName: row.companyName,
        leadCount: 0,
        wonCount: 0,
        lostCount: 0,
        openCount: 0,
        decidedCount: 0,
        closeRate: null,
        estimatedValueTotal: 0,
        estimatedValueWon: 0,
        lastLeadDate: null,
      };
      byContact.set(row.contactId, entry);
    }

    const estimate = row.estimate ?? 0;
    entry.leadCount += 1;
    entry.estimatedValueTotal += estimate;

    if (row.status === LeadStatus.WON) {
      entry.wonCount += 1;
      entry.estimatedValueWon += estimate;
    } else if (row.status === LeadStatus.LOST) {
      entry.lostCount += 1;
    } else {
      // Everything else is open, NULL status included: 27 leads in production carry no
      // status at all and they are still work sitting on somebody's desk.
      entry.openCount += 1;
    }

    // String compare is enough: start_date arrives as YYYY-MM-DD, which sorts
    // lexicographically. Null loses, so a dated lead always wins over an undated one.
    if (row.startDate && (entry.lastLeadDate === null || row.startDate > entry.lastLeadDate)) {
      entry.lastLeadDate = row.startDate;
    }
  }

  const scorecard = [...byContact.values()].map((entry) => ({
    ...entry,
    decidedCount: entry.wonCount + entry.lostCount,
    closeRate: closeRate(entry.wonCount, entry.lostCount),
    estimatedValueTotal: roundMoney(entry.estimatedValueTotal),
    estimatedValueWon: roundMoney(entry.estimatedValueWon),
  }));

  return scorecard.sort(
    (a, b) =>
      b.leadCount - a.leadCount ||
      b.estimatedValueWon - a.estimatedValueWon ||
      // Last tiebreak on id so two identical clients do not swap places between calls and
      // make `limit` return a different set each time.
      a.contactId - b.contactId,
  );
}

/** Summing floats in JS, so the cents have to be put back where they belong. */
function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
