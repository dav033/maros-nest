import {
  QboAiWarning,
  QboAttachmentSummary,
  QboNormalizedLine,
  QboRef,
} from './quickbooks-normalizer.types';

export function s(v: unknown): string {
  return v == null ? '' : String(v);
}

export function n(v: unknown): number {
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function o(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

export function a(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

export function extractRef(raw: unknown): QboRef | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const value = r['value'] != null ? s(r['value']) : '';
  if (!value) {
    const name = r['name'] != null ? s(r['name']) : '';
    if (!name) return undefined;
    return { value: '', name };
  }
  const ref: QboRef = { value };
  if (r['name'] != null) ref.name = s(r['name']);
  return ref;
}

export function warning(code: string, message: string): QboAiWarning {
  return { code, message };
}

export function dedupeWarnings(warnings: QboAiWarning[]): QboAiWarning[] {
  const byKey = new Map<string, QboAiWarning>();
  for (const w of warnings) byKey.set(`${w.code}:${w.message}`, w);
  return [...byKey.values()];
}

export function normalizeLines(lines: Record<string, unknown>[]): QboNormalizedLine[] {
  const result: QboNormalizedLine[] = [];
  for (const l of lines) {
    const normalized = normalizeLine(l);
    if (normalized) result.push(normalized);
  }
  return result;
}

function normalizeLine(l: Record<string, unknown>): QboNormalizedLine | null {
  const detailType = s(l['DetailType']);
  if (detailType === 'SubTotalLine') return null;

  const detail = o(l[detailType]);
  let account: QboRef | undefined;
  let item: QboRef | undefined;
  let customer = extractRef(l['CustomerRef']);
  let quantity: number | undefined;
  let unitPrice: number | undefined;
  let billableStatus: string | undefined;

  switch (detailType) {
    case 'SalesItemLineDetail':
      item = extractRef(detail['ItemRef']);
      customer = extractRef(detail['CustomerRef']) ?? customer;
      if (detail['Qty'] !== undefined) quantity = n(detail['Qty']);
      if (detail['UnitPrice'] !== undefined) unitPrice = n(detail['UnitPrice']);
      if (detail['BillableStatus']) billableStatus = s(detail['BillableStatus']);
      break;
    case 'AccountBasedExpenseLineDetail':
      account = extractRef(detail['AccountRef']);
      customer = extractRef(detail['CustomerRef']) ?? customer;
      if (detail['BillableStatus']) billableStatus = s(detail['BillableStatus']);
      break;
    case 'ItemBasedExpenseLineDetail':
      item = extractRef(detail['ItemRef']);
      account = extractRef(detail['AccountRef']);
      customer = extractRef(detail['CustomerRef']) ?? customer;
      if (detail['Qty'] !== undefined) quantity = n(detail['Qty']);
      if (detail['UnitPrice'] !== undefined) unitPrice = n(detail['UnitPrice']);
      if (detail['BillableStatus']) billableStatus = s(detail['BillableStatus']);
      break;
    case 'JournalEntryLineDetail': {
      account = extractRef(detail['AccountRef']);
      const entity = o(detail['Entity']);
      const entityRef = o(entity['EntityRef']);
      if (s(entity['Type']) === 'Customer' || s(entityRef['type']) === 'Customer') {
        customer = extractRef(entityRef) ?? customer;
      }
      break;
    }
    case 'DiscountLineDetail':
      account = extractRef(o(detail['DiscountAccountRef']));
      break;
    default:
      break;
  }

  const projectRefs = customer ? collectRefs([customer]) : [];
  const normalized: QboNormalizedLine = {
    amount: n(l['Amount']),
    description: s(l['Description']),
    detailType,
    projectRefs,
  };
  if (l['LineNum'] !== undefined) normalized.lineNum = n(l['LineNum']);
  if (account) {
    normalized.account = account;
    normalized.category = account;
  }
  if (item) normalized.item = item;
  if (customer) normalized.customer = customer;
  if (billableStatus) normalized.billableStatus = billableStatus;
  if (quantity !== undefined) normalized.quantity = quantity;
  if (unitPrice !== undefined) normalized.unitPrice = unitPrice;
  return normalized;
}

export function extractLinkedTxn(
  raw: Record<string, unknown>,
): Array<{ txnId: string; txnType: string }> {
  const linked = [
    ...extractLinkedTxnList(raw['LinkedTxn']),
    ...a(raw['Line']).flatMap((line) => extractLinkedTxnList(line['LinkedTxn'])),
  ];
  const byKey = new Map<string, { txnId: string; txnType: string }>();
  for (const lt of linked) {
    if (!lt.txnId && !lt.txnType) continue;
    byKey.set(`${lt.txnType}:${lt.txnId}`, lt);
  }
  return [...byKey.values()];
}

function extractLinkedTxnList(raw: unknown): Array<{ txnId: string; txnType: string }> {
  return a(raw).map((lt) => ({
    txnId: s(lt['TxnId']),
    txnType: s(lt['TxnType']),
  }));
}

export function extractMemo(raw: Record<string, unknown>): string {
  if (raw['PrivateNote']) return s(raw['PrivateNote']);
  const cm = raw['CustomerMemo'];
  if (cm && typeof cm === 'object') {
    const val = s((cm as Record<string, unknown>)['value']);
    if (val) return val;
  }
  return s(raw['Memo'] ?? '');
}

export function extractDescription(raw: Record<string, unknown>): string {
  if (raw['Description']) return s(raw['Description']);
  return extractMemo(raw);
}

export function collectProjectRefs(
  headerCustomer: QboRef | undefined,
  lineItems: QboNormalizedLine[],
): QboRef[] {
  const refs: QboRef[] = [];
  if (headerCustomer) refs.push(headerCustomer);
  for (const line of lineItems) {
    for (const ref of line.projectRefs) refs.push(ref);
  }
  return collectRefs(refs);
}

export function collectRefs(refs: QboRef[]): QboRef[] {
  const byKey = new Map<string, QboRef>();
  for (const ref of refs) {
    const key = projectRefKey(ref);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing || (!existing.name && ref.name)) byKey.set(key, ref);
  }
  return [...byKey.values()];
}

export function projectRefKey(ref: QboRef): string {
  if (ref.value) return `id:${ref.value}`;
  const name = s(ref.name).trim().toLowerCase();
  return name ? `name:${name}` : '';
}

export function normalizeAttachments(
  attachments: Record<string, unknown>[],
): QboAttachmentSummary[] {
  return attachments.map((attachment) => normalizeAttachable(attachment));
}

export function buildRawRef(
  entityType: string,
  raw: Record<string, unknown>,
): QboRef | undefined {
  const value = s(raw['Id']);
  return value ? { value, name: entityType } : undefined;
}

export function firstLineAccount(lineItems: QboNormalizedLine[]): QboRef | undefined {
  return lineItems.find((line) => line.account)?.account;
}

export function deriveBillableStatus(lineItems: QboNormalizedLine[]): string | undefined {
  const statuses = [...new Set(lineItems.map((line) => line.billableStatus).filter(Boolean))] as string[];
  if (statuses.length === 0) return undefined;
  return statuses.length === 1 ? statuses[0] : 'Mixed';
}

export function extractAttachableEntityRefs(
  raw: Record<string, unknown>,
): Array<{ entityType: string; entityId: string; name?: string }> {
  return a(raw['AttachableRef'])
    .map((ref) => {
      const entityRef = o(ref['EntityRef']);
      const entityId = s(entityRef['value']);
      const entityType = s(entityRef['type']);
      if (!entityId && !entityType) return null;
      const item: { entityType: string; entityId: string; name?: string } = {
        entityType,
        entityId,
      };
      if (entityRef['name']) item.name = s(entityRef['name']);
      return item;
    })
    .filter((ref): ref is { entityType: string; entityId: string; name?: string } => ref !== null);
}

export function deriveInvoiceStatus(raw: Record<string, unknown>): string {
  const balance = n(raw['Balance']);
  const total = n(raw['TotalAmt']);
  if (total > 0 && balance === 0) return 'Paid';
  if (balance > 0 && balance < total) return 'Partial';
  const dueStr = raw['DueDate'] ? s(raw['DueDate']) : '';
  if (dueStr && balance > 0 && new Date(dueStr) < new Date()) return 'Overdue';
  return 'Pending';
}

export function buildProjectWarnings(projectRefs: QboRef[]): QboAiWarning[] {
  const warnings: QboAiWarning[] = [];
  if (projectRefs.length === 0) {
    warnings.push({
      code: 'NO_PROJECT_REF',
      message: 'No customer/project reference found at header or line level.',
    });
  }
  for (const ref of projectRefs) {
    if (!ref.value && ref.name) {
      warnings.push({
        code: 'PROJECT_REF_NAME_ONLY',
        message: `CustomerRef has name '${ref.name}' but no ID value; project identity is name-only.`,
      });
    }
  }
  return warnings;
}

export function normalizeAttachable(raw: Record<string, unknown>): QboAttachmentSummary {
  return {
    attachableId: s(raw['Id']),
    fileName: s(raw['FileName']),
    contentType: s(raw['ContentType']),
    fileSize: raw['Size'] != null ? n(raw['Size']) : null,
    note: s(raw['Note']),
    txnDate: s(raw['TxnDate']),
    entityRefs: extractAttachableEntityRefs(raw),
  };
}
