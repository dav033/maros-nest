import { LeadStatus } from '../../../../common/enums/lead-status.enum';
import { Lead } from '../../../../entities/lead.entity';
import { Project } from '../../../../entities/project.entity';
import { QuickbooksProjectImportService } from './quickbooks-project-import.service';

const JOB_387 = '001R-0625, 3324 NW 14th St Fl 33, Miami, FL 33125, USA Roofing Leaking';
const JOB_283 = '001R-0625 C01, 3324 NW 14th St Fl 33, Miami, FL 33125, USA Roofing Leaking';

describe('QuickbooksProjectImportService', () => {
  let service: QuickbooksProjectImportService;
  let leads: Map<number, Lead>;
  let projects: Map<number, Project>;
  let projectRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let nextLeadId: number;
  let nextProjectId: number;
  let savepointsOpened: number;
  let savepointsRolledBack: number;
  let dataSourceTransactions: number;
  let taskWorkspaceAssignment: { ensureCanonicalLead: jest.Mock };

  beforeEach(() => {
    leads = new Map();
    projects = new Map();
    nextLeadId = 100;
    nextProjectId = 200;
    savepointsOpened = 0;
    savepointsRolledBack = 0;
    dataSourceTransactions = 0;

    // Job 387 is the base contract of change order 283 and both derive 001R-0625.
    const lead50 = Object.assign(new Lead(), {
      id: 50,
      leadNumber: '001R-0625',
      name: 'Re-Roof Lacayo',
      status: LeadStatus.WON,
      inReview: false,
    });
    leads.set(50, lead50);
    projects.set(
      70,
      Object.assign(new Project(), { id: 70, lead: lead50, quickbooks: true }),
    );

    const leadRepo = {
      find: jest.fn(() => Promise.resolve([...leads.values()])),
      findOne: jest.fn(({ where }: { where: { id?: number } }) =>
        Promise.resolve(where.id ? (leads.get(where.id) ?? null) : null),
      ),
      create: jest.fn((data: Partial<Lead>) => Object.assign(new Lead(), data)),
      save: jest.fn((lead: Lead) => {
        if (!lead.id) lead.id = nextLeadId++;
        leads.set(lead.id, lead);
        return Promise.resolve(lead);
      }),
    };
    projectRepo = {
      findOne: jest.fn(
        ({
          where,
        }: {
          where: { id?: number; qboCustomerId?: string; lead?: { id: number } };
        }) => {
          const all = [...projects.values()];
          if (where.qboCustomerId) {
            return Promise.resolve(
              all.find((project) => project.qboCustomerId === where.qboCustomerId) ?? null,
            );
          }
          if (where.id) return Promise.resolve(projects.get(where.id) ?? null);
          if (where.lead) {
            return Promise.resolve(
              all.find((project) => project.lead?.id === where.lead!.id) ?? null,
            );
          }
          return Promise.resolve(null);
        },
      ),
      create: jest.fn((data: Partial<Project>) => Object.assign(new Project(), data)),
      save: jest.fn((project: Project) => {
        if (!project.id) project.id = nextProjectId++;
        projects.set(project.id, project);
        return Promise.resolve(project);
      }),
    };

    // Contar savepoints no prueba que exista el savepoint: lo que hay que
    // imitar es que al fallar una decision se deshaga lo que ya habia escrito.
    const snapshot = () => ({
      leads: new Map<number, Lead>([...leads].map(([id, lead]) => [id, { ...lead }])),
      projects: new Map<number, Project>(
        [...projects].map(([id, project]) => [id, { ...project }]),
      ),
      nextLeadId,
      nextProjectId,
    });
    const rollbackTo = (saved: ReturnType<typeof snapshot>) => {
      for (const id of [...leads.keys()]) {
        if (!saved.leads.has(id)) leads.delete(id);
      }
      for (const [id, fields] of saved.leads) Object.assign(leads.get(id)!, fields);
      for (const id of [...projects.keys()]) {
        if (!saved.projects.has(id)) projects.delete(id);
      }
      for (const [id, fields] of saved.projects) Object.assign(projects.get(id)!, fields);
      nextLeadId = saved.nextLeadId;
      nextProjectId = saved.nextProjectId;
    };

    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === Lead) return leadRepo;
        if (entity === Project) return projectRepo;
        throw new Error(`Unexpected repository: ${entity?.name}`);
      }),
      // Nested transactions are SAVEPOINTs on Postgres — one per decision.
      transaction: jest.fn(async (callback: (m: unknown) => Promise<unknown>) => {
        savepointsOpened += 1;
        const saved = snapshot();
        try {
          return await callback(manager);
        } catch (error) {
          savepointsRolledBack += 1;
          rollbackTo(saved);
          throw error;
        }
      }),
    };
    const dataSource = {
      transaction: jest.fn((callback: (m: unknown) => Promise<unknown>) => {
        dataSourceTransactions += 1;
        return callback(manager);
      }),
    };
    const api = {
      queryAll: jest.fn(() =>
        Promise.resolve([
          { Id: '387', DisplayName: JOB_387, Active: true },
          { Id: '283', DisplayName: JOB_283, Active: true },
          { Id: '501', DisplayName: '002R-0725, 10 SW 1st Ave, Miami, FL', Active: true },
        ]),
      ),
    };
    const connectionRepo = {
      find: jest.fn(() => Promise.resolve([{ realmId: 'realm-1' }])),
    };
    taskWorkspaceAssignment = { ensureCanonicalLead: jest.fn().mockResolvedValue({}) };

    service = new QuickbooksProjectImportService(
      connectionRepo as never,
      leadRepo as never,
      projectRepo as never,
      api as never,
      { invalidateJobIndex: jest.fn() } as never,
      dataSource as never,
      taskWorkspaceAssignment as never,
    );
  });

  describe('importBatch', () => {
    it('rejects a change order taking the base number even when nothing is linked yet', async () => {
      const summary = await service.importBatch({
        decisions: [{ qboCustomerId: '283', projectNumber: '001R-0625' }],
      });

      expect(summary).toMatchObject({ total: 1, created: 0, linked: 0, rejected: 1 });
      expect(summary.results[0]).toMatchObject({
        qboCustomerId: '283',
        outcome: 'rejected',
        projectId: null,
        httpStatus: 409,
      });
      expect(summary.results[0].reason).toContain('001R-0625 CO01');
      // Y no se ha inventado ningun lead ni proyecto por el camino.
      expect([...projects.values()].some((p) => p.qboCustomerId === '283')).toBe(false);
    });

    it('keeps the accepted decisions when one of them is rejected', async () => {
      const summary = await service.importBatch({
        decisions: [
          { qboCustomerId: '387', projectNumber: '001R-0625', projectId: 70 },
          // The change order aimed at the project its base contract just took.
          { qboCustomerId: '283', projectNumber: '001R-0625', projectId: 70 },
          { qboCustomerId: '501', projectNumber: '002R-0725' },
        ],
      });

      expect(summary).toMatchObject({
        total: 3,
        created: 1,
        linked: 1,
        alreadyImported: 0,
        rejected: 1,
      });
      expect(summary.results[0]).toMatchObject({
        qboCustomerId: '387',
        outcome: 'linked',
        projectId: 70,
        leadId: 50,
        reason: null,
      });
      expect(summary.results[1]).toMatchObject({
        qboCustomerId: '283',
        projectNumber: '001R-0625',
        outcome: 'rejected',
        projectId: null,
        leadId: null,
        httpStatus: 409,
      });
      // La guarda de orden de cambio se evalua antes que el estado del destino, asi que
      // el motivo es el accionable: dice que numero usar en vez de solo que el destino
      // esta ocupado.
      expect(summary.results[1].reason).toContain('change order');
      expect(summary.results[1].reason).toContain('001R-0625 CO01');
      expect(summary.results[2]).toMatchObject({ qboCustomerId: '501', outcome: 'created' });

      // The rejected decision did not undo the accepted ones.
      expect(projects.get(70)?.qboCustomerId).toBe('387');
      const created = [...projects.values()].find(
        (project) => project.qboCustomerId === '501',
      );
      expect(created?.lead.leadNumber).toBe('002R-0725');
    });

    it('applies every decision in one transaction, each under its own savepoint', async () => {
      await service.importBatch({
        decisions: [
          { qboCustomerId: '387', projectNumber: '001R-0625', projectId: 70 },
          { qboCustomerId: '283', projectNumber: '001R-0625', projectId: 70 },
          { qboCustomerId: '501', projectNumber: '002R-0725' },
        ],
      });

      expect(dataSourceTransactions).toBe(1);
      expect(savepointsOpened).toBe(3);
      expect(savepointsRolledBack).toBe(1);
      expect(taskWorkspaceAssignment.ensureCanonicalLead).toHaveBeenCalledTimes(2);
    });

    it('undoes what a decision already wrote when it fails halfway', async () => {
      // El lead nuevo se guarda antes que el proyecto: si el proyecto revienta
      // contra el indice unico de qbo_customer_id, el savepoint tiene que
      // llevarse tambien el lead que esa misma decision acababa de crear.
      const saveProject = projectRepo.save.getMockImplementation()!;
      projectRepo.save.mockImplementation((project: Project) =>
        project.qboCustomerId === '501'
          ? Promise.reject(new Error('duplicate key value violates unique constraint'))
          : saveProject(project),
      );

      const summary = await service.importBatch({
        decisions: [
          { qboCustomerId: '387', projectNumber: '001R-0625', projectId: 70 },
          { qboCustomerId: '501', projectNumber: '002R-0725' },
        ],
      });

      expect(summary).toMatchObject({ total: 2, linked: 1, created: 0, rejected: 1 });
      expect(savepointsRolledBack).toBe(1);
      // La decision aceptada sobrevive...
      expect(projects.get(70)?.qboCustomerId).toBe('387');
      // ...y la rechazada no deja el lead huerfano que alcanzo a crear.
      expect([...leads.values()].some((lead) => lead.leadNumber === '002R-0725')).toBe(
        false,
      );
    });

    it('rejects a decision instead of the whole batch when the QuickBooks job is unknown', async () => {
      const summary = await service.importBatch({
        decisions: [
          { qboCustomerId: '999', projectNumber: '001R-0625' },
          { qboCustomerId: '387', projectNumber: '001R-0625', projectId: 70 },
        ],
      });

      expect(summary.rejected).toBe(1);
      expect(summary.results[0]).toMatchObject({ outcome: 'rejected', httpStatus: 404 });
      expect(summary.results[1].outcome).toBe('linked');
      // A job that never reached the database opens no savepoint.
      expect(savepointsOpened).toBe(1);
    });

    it('refuses an empty batch', async () => {
      await expect(service.importBatch({ decisions: [] })).rejects.toThrow(
        'Provide at least one import decision.',
      );
    });
  });

  describe('unlinkProject', () => {
    it('clears the QuickBooks link and keeps the project and its lead', async () => {
      await service.importJob({
        qboCustomerId: '387',
        projectNumber: '001R-0625',
        projectId: 70,
      });

      const result = await service.unlinkProject(70);

      expect(result).toEqual({
        projectId: 70,
        leadId: 50,
        previousQboCustomerId: '387',
        unlinked: true,
      });
      expect(projects.get(70)?.qboCustomerId).toBeNull();
      expect(projects.get(70)?.quickbooks).toBe(false);
      expect(leads.get(50)).toBeDefined();
    });

    it('is a no-op on a project that was never linked', async () => {
      const result = await service.unlinkProject(70);

      expect(result).toMatchObject({ unlinked: false, previousQboCustomerId: null });
    });
  });
});
