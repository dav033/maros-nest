import { projectNumberCandidates, resolveProjectNumber } from './invoice-project-number';

const LEADS = ['050P-0826', '050P-0726', '045-0726', '076-0726', '100-0826'];

describe('projectNumberCandidates', () => {
  it('reads the prefix from typical file names', () => {
    expect(projectNumberCandidates({ extracted: null, fileName: '050P-Lyon Plumbing - 69.60.pdf' })).toEqual(['050P']);
    expect(projectNumberCandidates({ extracted: null, fileName: '045-New Design & Builders - 3000.pdf' })).toEqual(['045']);
    expect(
      projectNumberCandidates({
        extracted: null,
        fileName: '2026-09-21T14-31-07-351Z-dca1f699-c755-47e7-9f47-fc04d4259a7a-050P-JJ_Air.pdf',
      }),
    ).toEqual(['050P']);
  });

  it('prefers what the model read on the document', () => {
    expect(projectNumberCandidates({ extracted: 'Job 076-0726', fileName: '050P-x.pdf' })).toEqual([
      '076-0726',
      '076',
      'JOB 076-0726',
      '050P',
    ]);
  });

  it('ignores file names without a project-looking prefix', () => {
    expect(projectNumberCandidates({ extracted: null, fileName: 'imagen-local.png' })).toEqual([]);
  });
});

describe('resolveProjectNumber', () => {
  it('matches a full lead number exactly', () => {
    expect(resolveProjectNumber(['076-0726'], LEADS)).toEqual({ projectNumber: '076-0726', warning: null });
  });

  it('matches a prefix when only one lead starts with it', () => {
    expect(resolveProjectNumber(['045'], LEADS)).toEqual({ projectNumber: '045-0726', warning: null });
  });

  it('warns when the prefix is ambiguous', () => {
    const result = resolveProjectNumber(['050P'], LEADS);
    expect(result.projectNumber).toBeNull();
    expect(result.warning).toContain('050P-0826, 050P-0726');
  });

  it('warns when nothing matches or nothing was found', () => {
    expect(resolveProjectNumber(['999'], LEADS).warning).toContain('No project matched "999"');
    expect(resolveProjectNumber([], LEADS).warning).toContain('No project number was found');
  });
});
