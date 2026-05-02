import { Injectable } from '@nestjs/common';

// ── Primitive reference types ──────────────────────────────────────────────

export interface QboRef {
  value: string;
  name?: string;
}

export interface QboMoney {
  amount: number;
  currencyCode?: string;
}

// ── Attachment summary — no TempDownloadUri (fetch on demand) ──────────────

export interface QboAttachmentSummary {
  attachableId: string;
  fileName: string;
  contentType: string;
  fileSize: number | null;
  note: string;
  txnDate: string;
  entityRefs: Array<{ entityType: string; entityId: string; name?: string }>;
}

// ── Normalized line item ───────────────────────────────────────────────────

export interface QboNormalizedLine {
  lineNum?: number;
  amount: number;
  description: string;
  detailType: string;
  account?: QboRef;
  category?: QboRef;
  item?: QboRef;
  customer?: QboRef;
  billableStatus?: string;
  quantity?: number;
  unitPrice?: number;
  /** QBO customer/project references detected in this line. */
  projectRefs: QboRef[];
}

// ── Transaction direction ──────────────────────────────────────────────────

export type QboDirection =
  | 'cash_in'
  | 'cash_out'
  | 'ap_open'
  | 'commitment'
  | 'credit'
  | 'adjustment';

// ── AI warning ─────────────────────────────────────────────────────────────

export interface QboAiWarning {
  code: string;
  message: string;
}

// ── Core normalized transaction ────────────────────────────────────────────

export interface QboNormalizedTransaction {
  source: 'quickbooks';
  direction: QboDirection;
  entityType: string;
  entityId: string;
  docNumber: string;
  txnDate: string;
  dueDate?: string;
  totalAmount: number;
  openBalance?: number;
  customer?: QboRef;
  vendor?: QboRef;
  /** Deduplicated QBO customer/project refs found at header and line level */
  projectRefs: QboRef[];
  lineItems: QboNormalizedLine[];
  linkedTxn: Array<{ txnId: string; txnType: string }>;
  account?: QboRef;
  category?: QboRef;
  memo: string;
  description: string;
  billableStatus?: string;
  attachments: QboAttachmentSummary[];
  rawRef?: QboRef;
  status?: string;
  warnings: QboAiWarning[];
}

export interface QboCashInTransaction extends QboNormalizedTransaction {
  direction: 'cash_in';
}

export interface QboCashOutTransaction extends QboNormalizedTransaction {
  direction: 'cash_out';
}

// ── Vendor summary ─────────────────────────────────────────────────────────

export interface QboVendorSummary {
  vendorId: string;
  displayName: string;
  email?: string;
  phone?: string;
  balance?: number;
  currency?: string;
  active: boolean;
}

// ── Project financial summary ──────────────────────────────────────────────

export interface QboProjectFinancialSummary {
  projectRef: string;
  estimatedAmount: number;
  invoicedAmount: number;
  paidAmount: number;
  openBalance: number;
  cashOut: number;
  netProfit: number;
}

// ── Module-level scalar helpers (pure, no state) ───────────────────────────

function s(v: unknown): string {
  return v == null ? '' : String(v);
}

function n(v: unknown): number {
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : 0;
}

function o(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function a(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

// ── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class QuickbooksNormalizerService {
  // ── Public normalizers ────────────────────────────────────────────────

  normalizeInvoice(
    raw: Record<string, unknown>,
    attachments: Record<string, unknown>[] = [],
  ): QboCashInTransaction {
    const lineItems = this.normalizeLines(a(raw['Line']));
    const customer = this.extractRef(raw['CustomerRef']);
    const projectRefs = this.collectProjectRefs(customer, lineItems);
    const billableStatus = this.deriveBillableStatus(lineItems);
    const result: QboCashInTransaction = {
      source: 'quickbooks',
      direction: 'cash_in',
      entityType: 'Invoice',
      entityId: s(raw['Id']),
      docNumber: s(raw['DocNumber']),
      txnDate: s(raw['TxnDate']),
      totalAmount: n(raw['TotalAmt']),
      openBalance: n(raw['Balance']),
      projectRefs,
      lineItems,
      linkedTxn: this.extractLinkedTxn(raw),
      memo: this.extractMemo(raw),
      description: this.extractDescription(raw),
      attachments: this.normalizeAttachments(attachments),
      rawRef: this.buildRawRef('Invoice', raw),
      status: this.deriveInvoiceStatus(raw),
      warnings: this.buildProjectWarnings(projectRefs),
    };
    if (raw['DueDate']) result.dueDate = s(raw['DueDate']);
    if (customer) result.customer = customer;
    if (billableStatus) result.billableStatus = billableStatus;
    return result;
  }

  normalizeEstimate(
    raw: Record<string, unknown>,
    attachments: Record<string, unknown>[] = [],
  ): QboNormalizedTransaction {
    const lineItems = this.normalizeLines(a(raw['Line']));
    const customer = this.extractRef(raw['CustomerRef']);
    const projectRefs = this.collectProjectRefs(customer, lineItems);
    const billableStatus = this.deriveBillableStatus(lineItems);
    const result: QboNormalizedTransaction = {
      source: 'quickbooks',
      direction: 'commitment',
      entityType: 'Estimate',
      entityId: s(raw['Id']),
      docNumber: s(raw['DocNumber']),
      txnDate: s(raw['TxnDate']),
      totalAmount: n(raw['TotalAmt']),
      projectRefs,
      lineItems,
      linkedTxn: this.extractLinkedTxn(raw),
      memo: this.extractMemo(raw),
      description: this.extractDescription(raw),
      attachments: this.normalizeAttachments(attachments),
      rawRef: this.buildRawRef('Estimate', raw),
      status: s(raw['TxnStatus']),
      warnings: this.buildProjectWarnings(projectRefs),
    };
    if (raw['ExpirationDate']) result.dueDate = s(raw['ExpirationDate']);
    if (customer) result.customer = customer;
    if (billableStatus) result.billableStatus = billableStatus;
    return result;
  }

  normalizePayment(
    raw: Record<string, unknown>,
    attachments: Record<string, unknown>[] = [],
  ): QboCashInTransaction {
    const lineItems = this.normalizeLines(a(raw['Line']));
    const customer = this.extractRef(raw['CustomerRef']);
    const projectRefs = this.collectProjectRefs(customer, lineItems);
    const billableStatus = this.deriveBillableStatus(lineItems);
    const result: QboCashInTransaction = {
      source: 'quickbooks',
      direction: 'cash_in',
      entityType: 'Payment',
      entityId: s(raw['Id']),
      docNumber: s(raw['DocNumber']),
      txnDate: s(raw['TxnDate']),
      totalAmount: n(raw['TotalAmt']),
      projectRefs,
      lineItems,
      linkedTxn: this.extractLinkedTxn(raw),
      memo: this.extractMemo(raw),
      description: this.extractDescription(raw),
      attachments: this.normalizeAttachments(attachments),
      rawRef: this.buildRawRef('Payment', raw),
      warnings: this.buildProjectWarnings(projectRefs),
    };
    if (customer) result.customer = customer;
    if (raw['UnappliedAmt'] !== undefined)
      result.openBalance = n(raw['UnappliedAmt']);
    const depositAccount = this.extractRef(raw['DepositToAccountRef']);
    if (depositAccount) result.account = depositAccount;
    if (billableStatus) result.billableStatus = billableStatus;
    return result;
  }

  normalizePurchase(
    raw: Record<string, unknown>,
    attachments: Record<string, unknown>[] = [],
  ): QboCashOutTransaction {
    const lineItems = this.normalizeLines(a(raw['Line']));
    const customer = this.extractRef(raw['CustomerRef']);
    const vendor = this.extractRef(raw['EntityRef']);
    const account = this.extractRef(raw['AccountRef']);
    const projectRefs = this.collectProjectRefs(customer, lineItems);
    const billableStatus = this.deriveBillableStatus(lineItems);
    const result: QboCashOutTransaction = {
      source: 'quickbooks',
      direction: 'cash_out',
      entityType: 'Purchase',
      entityId: s(raw['Id']),
      docNumber: s(raw['DocNumber']),
      txnDate: s(raw['TxnDate']),
      totalAmount: n(raw['TotalAmt']),
      projectRefs,
      lineItems,
      linkedTxn: this.extractLinkedTxn(raw),
      memo: this.extractMemo(raw),
      description: this.extractDescription(raw),
      attachments: this.normalizeAttachments(attachments),
      rawRef: this.buildRawRef('Purchase', raw),
      status: s(raw['PaymentType']),
      warnings: this.buildProjectWarnings(projectRefs),
    };
    if (customer) result.customer = customer;
    if (vendor) result.vendor = vendor;
    if (account) {
      result.account = account;
      result.category = account;
    }
    if (billableStatus) result.billableStatus = billableStatus;
    return result;
  }

  normalizeBill(
    raw: Record<string, unknown>,
    attachments: Record<string, unknown>[] = [],
  ): QboNormalizedTransaction {
    const lineItems = this.normalizeLines(a(raw['Line']));
    const customer = this.extractRef(raw['CustomerRef']);
    const vendor = this.extractRef(raw['VendorRef']);
    const account =
      this.extractRef(raw['APAccountRef']) ?? this.firstLineAccount(lineItems);
    const projectRefs = this.collectProjectRefs(customer, lineItems);
    const billableStatus = this.deriveBillableStatus(lineItems);
    const result: QboNormalizedTransaction = {
      source: 'quickbooks',
      direction: 'ap_open',
      entityType: 'Bill',
      entityId: s(raw['Id']),
      docNumber: s(raw['DocNumber']),
      txnDate: s(raw['TxnDate']),
      totalAmount: n(raw['TotalAmt']),
      openBalance: n(raw['Balance']),
      projectRefs,
      lineItems,
      linkedTxn: this.extractLinkedTxn(raw),
      memo: this.extractMemo(raw),
      description: this.extractDescription(raw),
      attachments: this.normalizeAttachments(attachments),
      rawRef: this.buildRawRef('Bill', raw),
      warnings: this.buildProjectWarnings(projectRefs),
    };
    if (raw['DueDate']) result.dueDate = s(raw['DueDate']);
    if (customer) result.customer = customer;
    if (vendor) result.vendor = vendor;
    if (account) {
      result.account = account;
      result.category = account;
    }
    if (billableStatus) result.billableStatus = billableStatus;
    return result;
  }

  normalizeBillPayment(
    raw: Record<string, unknown>,
    attachments: Record<string, unknown>[] = [],
  ): QboCashOutTransaction {
    const lineItems = this.normalizeLines(a(raw['Line']));
    const customer = this.extractRef(raw['CustomerRef']);
    const vendor = this.extractRef(raw['VendorRef']);
    const checkPay = o(raw['CheckPayment']);
    const ccPay = o(raw['CreditCardPayment']);
    const account =
      this.extractRef(checkPay['BankAccountRef']) ??
      this.extractRef(ccPay['CCAccountRef']);
    const projectRefs = this.collectProjectRefs(customer, lineItems);
    const billableStatus = this.deriveBillableStatus(lineItems);
    const result: QboCashOutTransaction = {
      source: 'quickbooks',
      direction: 'cash_out',
      entityType: 'BillPayment',
      entityId: s(raw['Id']),
      docNumber: s(raw['DocNumber']),
      txnDate: s(raw['TxnDate']),
      totalAmount: n(raw['TotalAmt']),
      projectRefs,
      lineItems,
      linkedTxn: this.extractLinkedTxn(raw),
      memo: this.extractMemo(raw),
      description: this.extractDescription(raw),
      attachments: this.normalizeAttachments(attachments),
      rawRef: this.buildRawRef('BillPayment', raw),
      status: s(raw['PayType']),
      warnings: this.buildProjectWarnings(projectRefs),
    };
    if (customer) result.customer = customer;
    if (vendor) result.vendor = vendor;
    if (account) result.account = account;
    if (billableStatus) result.billableStatus = billableStatus;
    return result;
  }

  normalizeVendorCredit(
    raw: Record<string, unknown>,
    attachments: Record<string, unknown>[] = [],
  ): QboNormalizedTransaction {
    const lineItems = this.normalizeLines(a(raw['Line']));
    const customer = this.extractRef(raw['CustomerRef']);
    const vendor = this.extractRef(raw['VendorRef']);
    const account =
      this.extractRef(raw['APAccountRef']) ?? this.firstLineAccount(lineItems);
    const projectRefs = this.collectProjectRefs(customer, lineItems);
    const billableStatus = this.deriveBillableStatus(lineItems);
    const result: QboNormalizedTransaction = {
      source: 'quickbooks',
      direction: 'credit',
      entityType: 'VendorCredit',
      entityId: s(raw['Id']),
      docNumber: s(raw['DocNumber']),
      txnDate: s(raw['TxnDate']),
      totalAmount: n(raw['TotalAmt']),
      openBalance: n(raw['Balance']),
      projectRefs,
      lineItems,
      linkedTxn: this.extractLinkedTxn(raw),
      memo: this.extractMemo(raw),
      description: this.extractDescription(raw),
      attachments: this.normalizeAttachments(attachments),
      rawRef: this.buildRawRef('VendorCredit', raw),
      warnings: this.buildProjectWarnings(projectRefs),
    };
    if (customer) result.customer = customer;
    if (vendor) result.vendor = vendor;
    if (account) {
      result.account = account;
      result.category = account;
    }
    if (billableStatus) result.billableStatus = billableStatus;
    return result;
  }

  normalizePurchaseOrder(
    raw: Record<string, unknown>,
    attachments: Record<string, unknown>[] = [],
  ): QboNormalizedTransaction {
    const lineItems = this.normalizeLines(a(raw['Line']));
    const customer = this.extractRef(raw['CustomerRef']);
    const vendor = this.extractRef(raw['VendorRef']);
    const account = this.firstLineAccount(lineItems);
    const projectRefs = this.collectProjectRefs(customer, lineItems);
    const billableStatus = this.deriveBillableStatus(lineItems);
    const result: QboNormalizedTransaction = {
      source: 'quickbooks',
      direction: 'commitment',
      entityType: 'PurchaseOrder',
      entityId: s(raw['Id']),
      docNumber: s(raw['DocNumber']),
      txnDate: s(raw['TxnDate']),
      totalAmount: n(raw['TotalAmt']),
      projectRefs,
      lineItems,
      linkedTxn: this.extractLinkedTxn(raw),
      memo: this.extractMemo(raw),
      description: this.extractDescription(raw),
      attachments: this.normalizeAttachments(attachments),
      rawRef: this.buildRawRef('PurchaseOrder', raw),
      status: s(raw['POStatus']),
      warnings: this.buildProjectWarnings(projectRefs),
    };
    if (raw['ShipDate']) result.dueDate = s(raw['ShipDate']);
    if (customer) result.customer = customer;
    if (vendor) result.vendor = vendor;
    if (account) {
      result.account = account;
      result.category = account;
    }
    if (billableStatus) result.billableStatus = billableStatus;
    return result;
  }

  normalizeJournalEntry(
    raw: Record<string, unknown>,
    attachments: Record<string, unknown>[] = [],
  ): QboNormalizedTransaction {
    const lineItems = this.normalizeLines(a(raw['Line']));
    const customer = this.extractRef(raw['CustomerRef']);
    const account = this.firstLineAccount(lineItems);
    const projectRefs = this.collectProjectRefs(customer, lineItems);
    const result: QboNormalizedTransaction = {
      source: 'quickbooks',
      direction: 'adjustment',
      entityType: 'JournalEntry',
      entityId: s(raw['Id']),
      docNumber: s(raw['DocNumber']),
      txnDate: s(raw['TxnDate']),
      totalAmount: n(raw['TotalAmt']),
      projectRefs,
      lineItems,
      linkedTxn: this.extractLinkedTxn(raw),
      memo: this.extractMemo(raw),
      description: this.extractDescription(raw),
      attachments: this.normalizeAttachments(attachments),
      rawRef: this.buildRawRef('JournalEntry', raw),
      warnings: this.buildProjectWarnings(projectRefs),
    };
    if (customer) result.customer = customer;
    if (account) {
      result.account = account;
      result.category = account;
    }
    return result;
  }

  normalizeVendor(raw: Record<string, unknown>): QboVendorSummary {
    const emailObj = o(raw['PrimaryEmailAddr']);
    const phoneObj = o(raw['PrimaryPhone']);
    const currencyObj = o(raw['CurrencyRef']);
    const result: QboVendorSummary = {
      vendorId: s(raw['Id']),
      displayName: s(raw['DisplayName']),
      active: raw['Active'] !== false,
    };
    if (emailObj['Address']) result.email = s(emailObj['Address']);
    if (phoneObj['FreeFormNumber'])
      result.phone = s(phoneObj['FreeFormNumber']);
    if (raw['Balance'] !== undefined) result.balance = n(raw['Balance']);
    if (currencyObj['value']) result.currency = s(currencyObj['value']);
    return result;
  }

  normalizeAttachable(raw: Record<string, unknown>): QboAttachmentSummary {
    return {
      attachableId: s(raw['Id']),
      fileName: s(raw['FileName']),
      contentType: s(raw['ContentType']),
      fileSize: raw['Size'] != null ? n(raw['Size']) : null,
      note: s(raw['Note']),
      txnDate: s(raw['TxnDate']),
      entityRefs: this.extractAttachableEntityRefs(raw),
    };
  }

  // ── Ref extractor — public for testing ───────────────────────────────

  extractRef(raw: unknown): QboRef | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const r = raw as Record<string, unknown>;
    const value = r['value'] != null ? s(r['value']) : '';
    if (!value) {
      // Fallback: name-only ref (project ID cannot be resolved)
      const name = r['name'] != null ? s(r['name']) : '';
      if (!name) return undefined;
      return { value: '', name };
    }
    const ref: QboRef = { value };
    if (r['name'] != null) ref.name = s(r['name']);
    return ref;
  }

  warning(code: string, message: string): QboAiWarning {
    return { code, message };
  }

  dedupeWarnings(warnings: QboAiWarning[]): QboAiWarning[] {
    const byKey = new Map<string, QboAiWarning>();
    for (const w of warnings) byKey.set(`${w.code}:${w.message}`, w);
    return [...byKey.values()];
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private normalizeLines(
    lines: Record<string, unknown>[],
  ): QboNormalizedLine[] {
    const result: QboNormalizedLine[] = [];
    for (const l of lines) {
      const normalized = this.normalizeLine(l);
      if (normalized) result.push(normalized);
    }
    return result;
  }

  private normalizeLine(l: Record<string, unknown>): QboNormalizedLine | null {
    const detailType = s(l['DetailType']);
    if (detailType === 'SubTotalLine') return null;

    const detail = o(l[detailType]);
    let account: QboRef | undefined;
    let item: QboRef | undefined;
    let customer = this.extractRef(l['CustomerRef']);
    let quantity: number | undefined;
    let unitPrice: number | undefined;
    let billableStatus: string | undefined;

    switch (detailType) {
      case 'SalesItemLineDetail':
        item = this.extractRef(detail['ItemRef']);
        customer = this.extractRef(detail['CustomerRef']) ?? customer;
        if (detail['Qty'] !== undefined) quantity = n(detail['Qty']);
        if (detail['UnitPrice'] !== undefined)
          unitPrice = n(detail['UnitPrice']);
        if (detail['BillableStatus'])
          billableStatus = s(detail['BillableStatus']);
        break;

      case 'AccountBasedExpenseLineDetail':
        account = this.extractRef(detail['AccountRef']);
        customer = this.extractRef(detail['CustomerRef']) ?? customer;
        if (detail['BillableStatus'])
          billableStatus = s(detail['BillableStatus']);
        break;

      case 'ItemBasedExpenseLineDetail':
        item = this.extractRef(detail['ItemRef']);
        account = this.extractRef(detail['AccountRef']);
        customer = this.extractRef(detail['CustomerRef']) ?? customer;
        if (detail['Qty'] !== undefined) quantity = n(detail['Qty']);
        if (detail['UnitPrice'] !== undefined)
          unitPrice = n(detail['UnitPrice']);
        if (detail['BillableStatus'])
          billableStatus = s(detail['BillableStatus']);
        break;

      case 'JournalEntryLineDetail': {
        account = this.extractRef(detail['AccountRef']);
        const entity = o(detail['Entity']);
        const entityRef = o(entity['EntityRef']);
        if (
          s(entity['Type']) === 'Customer' ||
          s(entityRef['type']) === 'Customer'
        ) {
          customer = this.extractRef(entityRef) ?? customer;
        }
        break;
      }

      case 'DiscountLineDetail':
        account = this.extractRef(o(detail['DiscountAccountRef']));
        break;

      default:
        break;
    }

    const projectRefs = customer ? this.collectRefs([customer]) : [];

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

  private extractLinkedTxn(
    raw: Record<string, unknown>,
  ): Array<{ txnId: string; txnType: string }> {
    const linked = [
      ...this.extractLinkedTxnList(raw['LinkedTxn']),
      ...a(raw['Line']).flatMap((line) =>
        this.extractLinkedTxnList(line['LinkedTxn']),
      ),
    ];
    const byKey = new Map<string, { txnId: string; txnType: string }>();
    for (const lt of linked) {
      if (!lt.txnId && !lt.txnType) continue;
      byKey.set(`${lt.txnType}:${lt.txnId}`, lt);
    }
    return [...byKey.values()];
  }

  private extractLinkedTxnList(
    raw: unknown,
  ): Array<{ txnId: string; txnType: string }> {
    return a(raw).map((lt) => ({
      txnId: s(lt['TxnId']),
      txnType: s(lt['TxnType']),
    }));
  }

  private extractMemo(raw: Record<string, unknown>): string {
    if (raw['PrivateNote']) return s(raw['PrivateNote']);
    const cm = raw['CustomerMemo'];
    if (cm && typeof cm === 'object') {
      const val = s((cm as Record<string, unknown>)['value']);
      if (val) return val;
    }
    return s(raw['Memo'] ?? '');
  }

  private extractDescription(raw: Record<string, unknown>): string {
    if (raw['Description']) return s(raw['Description']);
    return this.extractMemo(raw);
  }

  private collectProjectRefs(
    headerCustomer: QboRef | undefined,
    lineItems: QboNormalizedLine[],
  ): QboRef[] {
    const refs: QboRef[] = [];
    if (headerCustomer) refs.push(headerCustomer);
    for (const line of lineItems) {
      for (const ref of line.projectRefs) {
        refs.push(ref);
      }
    }
    return this.collectRefs(refs);
  }

  private collectRefs(refs: QboRef[]): QboRef[] {
    const byKey = new Map<string, QboRef>();
    for (const ref of refs) {
      const key = this.projectRefKey(ref);
      if (!key) continue;
      const existing = byKey.get(key);
      if (!existing || (!existing.name && ref.name)) {
        byKey.set(key, ref);
      }
    }
    return [...byKey.values()];
  }

  private projectRefKey(ref: QboRef): string {
    if (ref.value) return `id:${ref.value}`;
    const name = s(ref.name).trim().toLowerCase();
    return name ? `name:${name}` : '';
  }

  private normalizeAttachments(
    attachments: Record<string, unknown>[],
  ): QboAttachmentSummary[] {
    return attachments.map((attachment) =>
      this.normalizeAttachable(attachment),
    );
  }

  private buildRawRef(
    entityType: string,
    raw: Record<string, unknown>,
  ): QboRef | undefined {
    const value = s(raw['Id']);
    return value ? { value, name: entityType } : undefined;
  }

  private firstLineAccount(lineItems: QboNormalizedLine[]): QboRef | undefined {
    return lineItems.find((line) => line.account)?.account;
  }

  private deriveBillableStatus(
    lineItems: QboNormalizedLine[],
  ): string | undefined {
    const statuses = [
      ...new Set(lineItems.map((line) => line.billableStatus).filter(Boolean)),
    ] as string[];
    if (statuses.length === 0) return undefined;
    return statuses.length === 1 ? statuses[0] : 'Mixed';
  }

  private extractAttachableEntityRefs(
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
      .filter(
        (ref): ref is { entityType: string; entityId: string; name?: string } =>
          ref !== null,
      );
  }

  private deriveInvoiceStatus(raw: Record<string, unknown>): string {
    const balance = n(raw['Balance']);
    const total = n(raw['TotalAmt']);
    if (total > 0 && balance === 0) return 'Paid';
    if (balance > 0 && balance < total) return 'Partial';
    const dueStr = raw['DueDate'] ? s(raw['DueDate']) : '';
    if (dueStr && balance > 0 && new Date(dueStr) < new Date())
      return 'Overdue';
    return 'Pending';
  }

  private buildProjectWarnings(projectRefs: QboRef[]): QboAiWarning[] {
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
}
