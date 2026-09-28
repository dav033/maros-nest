import {
  detectChangeOrder,
  diagnoseImportJobs,
  ImportJobDiagnosisInput,
  projectNumberFromName,
} from './quickbooks-import-diagnostics';

/** Mirrors how listJobs builds a row before diagnosing it. */
function row(
  qboCustomerId: string,
  displayName: string,
  extras: Partial<ImportJobDiagnosisInput> = {},
): ImportJobDiagnosisInput {
  return {
    qboCustomerId,
    displayName,
    projectNumber: projectNumberFromName(displayName),
    importedProjectId: null,
    matchingLeads: [],
    ...extras,
  };
}

const JOB_387 = '001R-0625, 3324 NW 14th St Fl 33, Miami, FL 33125, USA Roofing Leaking';
const JOB_283 = '001R-0625 C01, 3324 NW 14th St Fl 33, Miami, FL 33125, USA Roofing Leaking';

describe('detectChangeOrder', () => {
  it('reads the change order out of the C01 spelling that collides with the base contract', () => {
    expect(detectChangeOrder(JOB_283)).toEqual({
      isChangeOrder: true,
      changeOrderNumber: 1,
      suggestedProjectNumber: '001R-0625 CO01',
    });
  });

  it('accepts the other spellings operators type', () => {
    expect(detectChangeOrder('001R-0625 CO 02, addr').changeOrderNumber).toBe(2);
    expect(detectChangeOrder('001R-0625 - C.O. 3, addr').changeOrderNumber).toBe(3);
    expect(detectChangeOrder('001R-0625, CO-4 addr').changeOrderNumber).toBe(4);
  });

  it('reports a bare CO marker without inventing an ordinal', () => {
    expect(detectChangeOrder('001R-0625 CO, addr')).toEqual({
      isChangeOrder: true,
      changeOrderNumber: null,
      suggestedProjectNumber: null,
    });
  });

  it('leaves the base contract alone, including names that only look like markers', () => {
    expect(detectChangeOrder(JOB_387).isChangeOrder).toBe(false);
    expect(detectChangeOrder('001R-0625 Corner St Roofing').isChangeOrder).toBe(false);
    expect(detectChangeOrder('001R-0625 C0123 Main St').isChangeOrder).toBe(false);
  });

  it('does not suggest a number when the name already spells CO the canonical way', () => {
    expect(projectNumberFromName('001R-0625 CO1, addr')).toBe('001R-0625 CO01');
    expect(detectChangeOrder('001R-0625 CO1, addr')).toEqual({
      isChangeOrder: true,
      changeOrderNumber: 1,
      suggestedProjectNumber: null,
    });
  });
});

describe('diagnoseImportJobs', () => {
  it('flags jobs 283 and 387 as a collision and tells the change order from the base contract', () => {
    const [contract, changeOrder] = diagnoseImportJobs([
      row('387', JOB_387),
      row('283', JOB_283),
    ]);

    expect(contract.status).toBe('colision');
    expect(contract.role).toBe('contrato_base');
    expect(contract.collidesWith).toEqual([
      {
        qboCustomerId: '283',
        displayName: JOB_283,
        role: 'orden_de_cambio',
        changeOrderNumber: 1,
        importedProjectId: null,
      },
    ]);
    expect(contract.statusDetail).toContain('2 QuickBooks jobs derive project number 001R-0625');

    expect(changeOrder.status).toBe('colision');
    expect(changeOrder.role).toBe('orden_de_cambio');
    expect(changeOrder.changeOrderNumber).toBe(1);
    expect(changeOrder.suggestedProjectNumber).toBe('001R-0625 CO01');
    expect(changeOrder.collidesWith.map((other) => other.qboCustomerId)).toEqual(['387']);
  });

  it('collides even when the base project number is free in the CRM', () => {
    const lead = { leadId: 50, projectId: 70, qboCustomerId: null };
    const [contract, changeOrder] = diagnoseImportJobs([
      row('387', JOB_387, { matchingLeads: [lead] }),
      row('283', JOB_283, { matchingLeads: [lead] }),
    ]);

    expect(contract.status).toBe('colision');
    expect(changeOrder.status).toBe('colision');
    expect(contract.conflictProjectId).toBeNull();
  });

  it('cannot name the base contract when no colliding job carries a marker', () => {
    const [first, second] = diagnoseImportJobs([
      row('900', '003R-0825, 10 SW 1st Ave'),
      row('901', '003R-0825, 10 SW 1st Ave unit 2'),
    ]);

    expect(first.status).toBe('colision');
    expect(first.role).toBe('indeterminado');
    expect(second.role).toBe('indeterminado');
  });

  it('keeps a canonically spelled change order apart from its base contract', () => {
    const [contract, changeOrder] = diagnoseImportJobs([
      row('387', JOB_387),
      row('284', '001R-0625 CO1, 3324 NW 14th St'),
    ]);

    expect(contract.status).toBe('ok');
    expect(contract.collidesWith).toEqual([]);
    expect(changeOrder.status).toBe('ok');
    expect(changeOrder.role).toBe('orden_de_cambio');
  });

  it('reports sin_numero when no project number can be derived from the name', () => {
    const [diagnosis] = diagnoseImportJobs([row('12', '0000 Office Maros construction')]);

    expect(projectNumberFromName('0000 Office Maros construction')).toBeNull();
    expect(diagnosis.status).toBe('sin_numero');
    expect(diagnosis.collidesWith).toEqual([]);
    expect(diagnosis.statusDetail).toContain('No project number could be derived');
  });

  it('groups jobs by number, not by missing number', () => {
    const diagnoses = diagnoseImportJobs([
      row('12', '0000 Office Maros construction'),
      row('13', '0000 Warehouse Maros construction'),
    ]);

    expect(diagnoses.every((diagnosis) => diagnosis.status === 'sin_numero')).toBe(true);
    expect(diagnoses.every((diagnosis) => diagnosis.collidesWith.length === 0)).toBe(true);
  });

  it('reports numero_en_uso when the only matching project belongs to another job', () => {
    const [diagnosis] = diagnoseImportJobs([
      row('387', JOB_387, {
        matchingLeads: [{ leadId: 50, projectId: 70, qboCustomerId: '999' }],
      }),
    ]);

    expect(diagnosis.status).toBe('numero_en_uso');
    expect(diagnosis.conflictProjectId).toBe(70);
    expect(diagnosis.statusDetail).toContain('already linked to a different QuickBooks job');
  });

  it('stays ok when one of the matching leads is still free', () => {
    const [diagnosis] = diagnoseImportJobs([
      row('387', JOB_387, {
        matchingLeads: [
          { leadId: 50, projectId: 70, qboCustomerId: '999' },
          { leadId: 51, projectId: null, qboCustomerId: null },
        ],
      }),
    ]);

    expect(diagnosis.status).toBe('ok');
    expect(diagnosis.conflictProjectId).toBe(70);
  });

  it('reports ya_importado ahead of any collision, and still names the other job', () => {
    const [contract, changeOrder] = diagnoseImportJobs([
      row('387', JOB_387, {
        importedProjectId: 70,
        matchingLeads: [{ leadId: 50, projectId: 70, qboCustomerId: '387' }],
      }),
      row('283', JOB_283, {
        matchingLeads: [{ leadId: 50, projectId: 70, qboCustomerId: '387' }],
      }),
    ]);

    expect(contract.status).toBe('ya_importado');
    expect(contract.statusDetail).toBe('Already imported as CRM project 70.');
    // The change order is now blocked by the link its base contract took.
    expect(changeOrder.status).toBe('numero_en_uso');
    expect(changeOrder.conflictProjectId).toBe(70);
    expect(changeOrder.collidesWith[0]).toMatchObject({
      qboCustomerId: '387',
      importedProjectId: 70,
    });
  });

  it('is ok when the number is new to the CRM and no other job claims it', () => {
    const [diagnosis] = diagnoseImportJobs([row('501', '002R-0725, 10 SW 1st Ave')]);

    expect(diagnosis.status).toBe('ok');
    expect(diagnosis.role).toBe('contrato_base');
    expect(diagnosis.statusDetail).toBe('Ready to import.');
  });
});
