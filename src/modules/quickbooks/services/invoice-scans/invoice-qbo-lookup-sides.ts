import type { ExtractedInvoiceData } from '../../entities/invoice-scan.entity';

/**
 * Which side of QuickBooks a scanned document needs looked up.
 *
 * `revenue` means Customers and service Items (we billed someone); `expense` means Vendors
 * and expense Accounts (someone billed us, or we paid out). Both can be true at once, and
 * that is the point of this module.
 */
export interface QboLookupSides {
  revenue: boolean;
  expense: boolean;
}

const EXPENSE_CLASSIFICATIONS = new Set(['materials_expense', 'subcontractor_expense']);
const REVENUE_CLASSIFICATIONS = new Set(['customer_service']);

/**
 * What the document's classification implies about which side it belongs to, or null when
 * it implies nothing (`other` / `unknown`).
 */
function sideFromClassification(
  classification: ExtractedInvoiceData['classification'],
): keyof QboLookupSides | null {
  if (EXPENSE_CLASSIFICATIONS.has(classification)) return 'expense';
  if (REVENUE_CLASSIFICATIONS.has(classification)) return 'revenue';
  return null;
}

/**
 * Decides which QuickBooks lists to offer the reviewer, from the two independent things the
 * extractor reports: the document's `direction` and its `classification`.
 *
 * Why this is not just `direction`. The extraction instruction defines direction as a
 * document type — outgoing is "Maros issued a customer invoice", incoming is "a supplier
 * billed Maros" — but a third kind of paper arrives in practice and fits neither: a proof
 * of payment Maros made (a Zelle or Square screenshot, a subcontractor receipt). Asked to
 * pick, the model reads the cash flow and answers `outgoing`, because the money did go out.
 *
 * Keying the lookup off that alone is what produced the symptom this exists to fix: seven
 * such documents, five of them classified `subcontractor_expense`, had their counterparty
 * searched against the *Customer* list — so the best match offered for a subcontractor was
 * a customer at 37% confidence, and no expense account was fetched at all, while the
 * reviewer had no correct option to choose. Documents the extractor labelled `incoming`
 * matched at 86-100% over the same period, which is what a working lookup looks like.
 *
 * The rule is deliberately additive: when direction and classification disagree, both sides
 * are looked up rather than the classification overriding the direction. A disagreement
 * means one of the two signals is wrong and nothing here can tell which — the data has
 * contradictions in both directions, including an `incoming` document classified
 * `customer_service` that nonetheless matched a vendor at 100%. Narrowing on the wrong
 * signal would replace a bad suggestion with a different bad suggestion; widening costs two
 * more parallel queries and leaves the choice with the person who can see the document.
 */
export function resolveQboLookupSides(
  direction: ExtractedInvoiceData['direction'],
  classification: ExtractedInvoiceData['classification'],
): QboLookupSides {
  const fromDirection: keyof QboLookupSides | null =
    direction === 'outgoing' ? 'revenue' : direction === 'incoming' ? 'expense' : null;

  // An unreadable direction already meant "offer everything", and still does.
  if (fromDirection === null) return { revenue: true, expense: true };

  const fromClassification = sideFromClassification(classification);
  if (fromClassification === null || fromClassification === fromDirection) {
    return {
      revenue: fromDirection === 'revenue',
      expense: fromDirection === 'expense',
    };
  }

  return { revenue: true, expense: true };
}

/**
 * True when the two signals point at opposite sides — the case worth surfacing to whoever
 * reviews the scan, because one of them is wrong about a document that moves money.
 */
export function hasDirectionClassificationConflict(
  direction: ExtractedInvoiceData['direction'],
  classification: ExtractedInvoiceData['classification'],
): boolean {
  const fromClassification = sideFromClassification(classification);
  if (fromClassification === null) return false;
  if (direction === 'outgoing') return fromClassification === 'expense';
  if (direction === 'incoming') return fromClassification === 'revenue';
  return false;
}
