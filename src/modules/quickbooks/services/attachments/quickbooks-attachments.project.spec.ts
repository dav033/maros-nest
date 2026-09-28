import { QuickbooksApiService } from '../core/quickbooks-api.service';
import { QuickbooksNormalizerService } from '../core/quickbooks-normalizer.service';
import { QuickbooksAttachmentsHelpers } from './quickbooks-attachments.helpers';
import { QuickbooksAttachmentsProjectService } from './quickbooks-attachments.project';

describe('QuickbooksAttachmentsProjectService.findProjectRefs', () => {
  let service: QuickbooksAttachmentsProjectService;
  let apiService: jest.Mocked<Pick<QuickbooksApiService, 'queryAll' | 'escapeQboString'>>;

  const whereClauses = (): string[] =>
    apiService.queryAll.mock.calls
      .filter((call) => call[1] === 'Customer')
      .map((call) => String((call[2] as { where?: string })?.where ?? ''));

  beforeEach(() => {
    apiService = {
      queryAll: jest.fn().mockResolvedValue([]),
      escapeQboString: jest.fn((value: string) => value.replace(/'/g, "''")),
    };
    service = new QuickbooksAttachmentsProjectService(
      apiService as unknown as QuickbooksApiService,
      new QuickbooksNormalizerService(),
      new QuickbooksAttachmentsHelpers(),
    );
  });

  it('queries each name field separately, without OR or grouping parentheses', async () => {
    await service.findProjectRefs('realm-1', { projectNumber: '074P-0926' });

    const wheres = whereClauses();
    expect(wheres).toHaveLength(2);
    expect(wheres.some((where) => where.includes('DisplayName LIKE'))).toBe(true);
    expect(
      wheres.some((where) => where.includes('FullyQualifiedName LIKE')),
    ).toBe(true);
    for (const where of wheres) {
      expect(where).not.toMatch(/\bOR\b/);
      expect(where).not.toContain('(');
      expect(where).not.toContain(')');
      expect(where).not.toContain('ESCAPE');
    }
  });

  it('merges both queries and deduplicates customers by Id', async () => {
    apiService.queryAll.mockImplementation(
      (_realmId: string, _entity: string, options?: { where?: string }) =>
        Promise.resolve(
          options?.where?.includes('FullyQualifiedName')
            ? [
                { Id: '55', DisplayName: '074P-0926', FullyQualifiedName: 'Acme:074P-0926' },
                { Id: '77', DisplayName: 'other', FullyQualifiedName: 'Acme:other' },
              ]
            : [
                {
                  Id: '55',
                  DisplayName: '074P-0926',
                  FullyQualifiedName: 'Acme:074P-0926',
                },
              ],
        ),
    );

    const result = await service.findProjectRefs('realm-1', {
      projectNumber: '074P-0926',
    });

    expect(apiService.queryAll).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      found: true,
      qboCustomerId: '55',
      displayName: '074P-0926',
    });
  });

  it('escapes single quotes in the LIKE pattern', async () => {
    await service.findProjectRefs('realm-1', { projectNumber: "o'brien" });

    for (const where of whereClauses()) {
      expect(where).toContain("LIKE 'o''brien%'");
    }
  });
});

describe('QuickbooksAttachmentsProjectService.getProjectRelatedEntityRefs', () => {
  /**
   * Properties QuickBooks refuses to project for each entity (verified against
   * the live API: it answers 400 "Property X not found for Entity Y").
   */
  const REJECTED: Record<string, string[]> = {
    Invoice: ['Memo'],
    Estimate: ['Memo'],
    Payment: ['Memo', 'CustomerMemo'],
    Purchase: ['Memo', 'CustomerMemo', 'CustomerRef', 'LinkedTxn'],
    Bill: ['Memo', 'CustomerMemo', 'CustomerRef', 'LinkedTxn'],
    // LinkedTxn NO esta aqui: BillPayment si lo acepta (verificado en vivo).
    BillPayment: [
      'Memo',
      'CustomerMemo',
      'CustomerRef',
      'PayType',
      'CheckPayment',
      'CreditCardPayment',
    ],
    VendorCredit: ['Memo', 'CustomerMemo', 'CustomerRef', 'LinkedTxn', 'Balance'],
    // Memo NO esta aqui: PurchaseOrder si lo acepta (verificado en vivo).
    PurchaseOrder: ['CustomerMemo', 'CustomerRef', 'LinkedTxn', 'ShipDate', 'POStatus'],
    JournalEntry: ['Memo', 'CustomerMemo', 'CustomerRef', 'LinkedTxn', 'TotalAmt'],
  };

  it('only projects properties QuickBooks accepts for each entity', async () => {
    const apiService = {
      queryAll: jest.fn().mockResolvedValue([]),
      escapeQboString: jest.fn((value: string) => value),
      buildDateWhereClause: jest.fn(() => ({})),
    };
    const service = new QuickbooksAttachmentsProjectService(
      apiService as unknown as QuickbooksApiService,
      new QuickbooksNormalizerService(),
      new QuickbooksAttachmentsHelpers(),
    );

    await service.getProjectRelatedEntityRefs(
      'realm-1',
      { found: true, qboCustomerId: '55', refs: [{ value: '55' }] },
      {},
    );

    const selectsByEntity = new Map<string, string[]>();
    for (const call of apiService.queryAll.mock.calls) {
      const entity = call[1] as string;
      const select = (call[2] as { select?: string })?.select;
      if (!select) continue;
      selectsByEntity.set(
        entity,
        select.split(',').map((field) => field.trim()),
      );
    }

    for (const [entity, rejected] of Object.entries(REJECTED)) {
      const fields = selectsByEntity.get(entity);
      expect(fields).toBeDefined();
      for (const property of rejected) {
        expect(fields).not.toContain(property);
      }
    }

    // Propiedades que QBO SI acepta y que el normalizador necesita. Estan aqui
    // porque una bisección por mensaje de error las quitó de más: sin ellas el
    // dato no llega y el normalizador lo da por vacío en vez de por fallido.
    for (const [entity, property] of [
      ['BillPayment', 'LinkedTxn'],
      ['PurchaseOrder', 'Memo'],
    ] as const) {
      expect(selectsByEntity.get(entity)).toContain(property);
    }
  });
});

describe('QuickbooksAttachmentsProjectService degrada por partes', () => {
  const build = (queryAll: jest.Mock) =>
    new QuickbooksAttachmentsProjectService(
      {
        queryAll,
        escapeQboString: jest.fn((value: string) => value.replace(/'/g, "''")),
        buildDateWhereClause: jest.fn(() => ({})),
      } as unknown as QuickbooksApiService,
      new QuickbooksNormalizerService(),
      new QuickbooksAttachmentsHelpers(),
    );

  it('keeps the Customer name field that answered when the other one fails', async () => {
    const queryAll = jest.fn((_realm: string, _entity: string, options: { where?: string }) =>
      options.where?.includes('FullyQualifiedName')
        ? Promise.reject(new Error('QBO 400'))
        : Promise.resolve([{ Id: '55', DisplayName: '074P-0926' }]),
    );

    const project = await build(queryAll as unknown as jest.Mock).findProjectRefs('realm-1', {
      projectNumber: '074P-0926',
    });

    expect(project.found).toBe(true);
    expect(project.qboCustomerId).toBe('55');
  });

  it('only fails the Customer lookup when neither name field answers', async () => {
    const queryAll = jest.fn(() => Promise.reject(new Error('QBO 400')));
    await expect(
      build(queryAll as unknown as jest.Mock).findProjectRefs('realm-1', {
        projectNumber: '074P-0926',
      }),
    ).rejects.toThrow('QBO 400');
  });

  it('loses only the failing entity, not the other eight, and says so', async () => {
    const queryAll = jest.fn((_realm: string, entity: string) =>
      entity === 'Bill'
        ? Promise.reject(new Error('Property Nope not found for Entity Bill'))
        : entity === 'Invoice'
          ? Promise.resolve([
              { Id: '9', TotalAmt: 100, CustomerRef: { value: '55' } },
            ])
          : Promise.resolve([]),
    );

    const { refs, warnings } = await build(
      queryAll as unknown as jest.Mock,
    ).getProjectRelatedEntityRefs(
      'realm-1',
      { found: true, qboCustomerId: '55', refs: [{ value: '55' }] },
      {},
    );

    expect(refs).toContainEqual(expect.objectContaining({ entityType: 'Invoice', entityId: '9' }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('project_entity_query_failed');
    expect(warnings[0].message).toContain('Bill');
  });
});
