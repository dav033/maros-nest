import type { Repository } from 'typeorm';
import { LeadType } from '../../../../common/enums/lead-type.enum';
import { runWithRequestScope } from '../../../../common/auth/request-scope';
import { Lead } from '../../../../entities/lead.entity';
import { LeadsRepository } from './leads.repository';

/**
 * Que el ámbito llegue de verdad a la consulta.
 *
 * El helper tiene sus propias pruebas; lo que se prueba aquí es el cableado, que
 * es donde se escapan estas cosas: un método de lectura que se olvida de
 * aplicarlo devuelve los leads de todos los tipos y nada falla a la vista.
 */
type Captured = { clause: string; parameters: Record<string, unknown> };

function harness() {
  const captured: Captured[] = [];
  const qb: Record<string, unknown> = {};
  for (const method of [
    'createQueryBuilder',
    'leftJoinAndSelect',
    'leftJoin',
    'innerJoin',
    'select',
    'addSelect',
    'groupBy',
    'orderBy',
    'where',
    'limit',
  ]) {
    qb[method] = jest.fn(() => qb);
  }
  qb.andWhere = jest.fn((clause: string, parameters: Record<string, unknown>) => {
    captured.push({ clause, parameters });
    return qb;
  });
  qb.getMany = jest.fn(() => Promise.resolve([]));
  qb.getRawMany = jest.fn(() => Promise.resolve([]));
  qb.getCount = jest.fn(() => Promise.resolve(0));

  const repo = {
    createQueryBuilder: jest.fn(() => qb),
    count: jest.fn(() => Promise.resolve(0)),
    find: jest.fn(() => Promise.resolve([])),
    findOne: jest.fn(() => Promise.resolve(null)),
  } as unknown as Repository<Lead>;

  return { repository: new LeadsRepository(repo), captured, repo };
}

/** Las condiciones que mencionan la columna del número de lead. */
function scopeClauses(captured: Captured[]): Captured[] {
  return captured.filter((entry) => entry.clause.includes('lead.lead_number'));
}

describe('LeadsRepository, el ámbito por tipo de lead', () => {
  const SCOPE = { scopedLeadTypes: [LeadType.PLUMBING] };

  it.each([
    ['findAll', (r: LeadsRepository) => r.findAll()],
    ['findAllForPicker', (r: LeadsRepository) => r.findAllForPicker()],
    ['findPipeline', (r: LeadsRepository) => r.findPipeline()],
    ['findInReview', (r: LeadsRepository) => r.findInReview()],
    ['findByStatus', (r: LeadsRepository) => r.findByStatus('WON')],
    ['getStatusCounts', (r: LeadsRepository) => r.getStatusCounts()],
    ['findStatusSeed', (r: LeadsRepository) => r.findStatusSeed()],
    ['getTotalCount', (r: LeadsRepository) => r.getTotalCount()],
    ['findByContactId', (r: LeadsRepository) => r.findByContactId(1)],
    ['findByContactName', (r: LeadsRepository) => r.findByContactName('ana')],
    ['searchByName', (r: LeadsRepository) => r.searchByName('obra')],
  ])('%s applies it', async (_label, run) => {
    const h = harness();

    await runWithRequestScope(SCOPE, () => run(h.repository));

    expect(scopeClauses(h.captured)).toHaveLength(1);
  });

  /**
   * `findByLeadType` aplica dos condiciones a proposito: el tipo que piden y el
   * ambito del usuario. Pedir roofing con ambito de plomeria no devuelve nada,
   * que es lo correcto — el ambito se suma, no se sustituye.
   */
  it('findByLeadType applies the scope on top of the requested type', async () => {
    const h = harness();

    await runWithRequestScope(SCOPE, () =>
      h.repository.findByLeadType(LeadType.ROOFING),
    );

    const clauses = scopeClauses(h.captured);
    expect(clauses).toHaveLength(2);
    expect(clauses[0].parameters).toEqual({
      leadNumberPattern: '^[0-9]+R-[0-9]+([^0-9].*)?$',
    });
    expect(Object.values(clauses[1].parameters)).toEqual([
      '^[0-9]+P-[0-9]+([^0-9].*)?$',
    ]);
  });

  it('adds nothing for a user with no restriction', async () => {
    const h = harness();

    await runWithRequestScope({ scopedLeadTypes: null }, () => h.repository.findAll());

    expect(scopeClauses(h.captured)).toHaveLength(0);
  });

  /**
   * Deliberadamente fuera. Esto alimenta la numeración de leads: filtrarlo haría
   * que un usuario restringido a plomería no viese los números de construcción y
   * generase uno ya usado — un filtro de visibilidad convertido en duplicados.
   */
  it('leaves lead numbering alone', async () => {
    const h = harness();

    await runWithRequestScope(SCOPE, () =>
      h.repository.findAllLeadNumbersByType(LeadType.PLUMBING),
    );

    expect(scopeClauses(h.captured)).toHaveLength(0);
  });

  /**
   * `searchByName` tenía tres `orWhere`. Un `andWhere` detrás se habría pegado
   * sólo al último —"a OR b OR (c AND ámbito)" por precedencia de SQL— y los dos
   * primeros criterios se habrían escapado del filtro.
   */
  it('keeps the search criteria inside one bracketed condition', async () => {
    const h = harness();

    await runWithRequestScope(SCOPE, () => h.repository.searchByName('obra'));

    const where = (h.repo.createQueryBuilder as jest.Mock).mock.results[0].value.where as
      jest.Mock;
    const [clause] = where.mock.calls[0];
    expect(clause).toMatch(/^\(.*OR.*OR.*\)$/s);
    expect(where).toHaveBeenCalledTimes(1);
  });
});
