import { LeadType } from '../enums/lead-type.enum';
import {
  applyLeadTypeScope,
  canSeeLeadNumber,
  currentLeadTypeScope,
  runWithRequestScope,
} from './request-scope';

type Captured = { clause: string; parameters: Record<string, string> };

/** Un query builder de mentira que solo recuerda lo que le anadieron. */
function fakeQb() {
  const calls: Captured[] = [];
  const qb = {
    calls,
    andWhere(clause: string, parameters: Record<string, string>) {
      calls.push({ clause, parameters });
      return qb;
    },
  };
  return qb as unknown as Parameters<typeof applyLeadTypeScope>[0] & { calls: Captured[] };
}

describe('currentLeadTypeScope', () => {
  /**
   * Fuera de una peticion HTTP no hay usuario a quien restringir. Devolver un
   * ambito ahi esconderia datos de una herramienta de MCP o de un cron sin que
   * nadie lo hubiera pedido.
   */
  it('has no scope outside a request', () => {
    expect(currentLeadTypeScope()).toBeNull();
  });

  it('reads the scope of the running request', () => {
    runWithRequestScope({ scopedLeadTypes: [LeadType.PLUMBING] }, () => {
      expect(currentLeadTypeScope()).toEqual([LeadType.PLUMBING]);
    });
  });

  /** `null` es "ve todos los tipos", que es lo que tiene quien no esta restringido. */
  it('treats null as no restriction', () => {
    runWithRequestScope({ scopedLeadTypes: null }, () => {
      expect(currentLeadTypeScope()).toBeNull();
    });
  });

  /**
   * Un array vacio tampoco restringe. La base lo rechaza con un CHECK, pero si
   * alguno llegara por otra via, "restringido a ningun tipo" dejaria una
   * pantalla vacia indistinguible de un fallo — es mas seguro leerlo como "sin
   * restriccion" que como "sin nada".
   */
  it('treats an empty list as no restriction', () => {
    runWithRequestScope({ scopedLeadTypes: [] }, () => {
      expect(currentLeadTypeScope()).toBeNull();
    });
  });

  it('does not leak the scope out of the request', () => {
    runWithRequestScope({ scopedLeadTypes: [LeadType.ROOFING] }, () => undefined);
    expect(currentLeadTypeScope()).toBeNull();
  });
});

describe('applyLeadTypeScope', () => {
  it('adds nothing when the request is not restricted', () => {
    const qb = fakeQb();
    runWithRequestScope({ scopedLeadTypes: null }, () => {
      applyLeadTypeScope(qb, 'lead.lead_number');
    });
    expect(qb.calls).toHaveLength(0);
  });

  /**
   * El tipo no es una columna: se deriva del patron del numero. `053P-1025` es
   * plumbing, `053R-1025` roofing.
   */
  it('filters by the lead number pattern, not by a column', () => {
    const qb = fakeQb();
    runWithRequestScope({ scopedLeadTypes: [LeadType.PLUMBING] }, () => {
      applyLeadTypeScope(qb, 'lead.lead_number');
    });

    expect(qb.calls).toHaveLength(1);
    expect(qb.calls[0].clause).toContain('lead.lead_number ~');
    expect(Object.values(qb.calls[0].parameters)[0]).toBe('^[0-9]+P-[0-9]+([^0-9].*)?$');
  });

  it('ORs the patterns of several types', () => {
    const qb = fakeQb();
    runWithRequestScope({ scopedLeadTypes: [LeadType.PLUMBING, LeadType.ROOFING] }, () => {
      applyLeadTypeScope(qb, 'lead.lead_number');
    });

    expect(qb.calls[0].clause).toMatch(/\(.+\) OR \(.+\)/);
    expect(Object.values(qb.calls[0].parameters)).toEqual([
      '^[0-9]+P-[0-9]+([^0-9].*)?$',
      '^[0-9]+R-[0-9]+([^0-9].*)?$',
    ]);
  });

  /** Construccion es el cajon de todo lo que no lleva prefijo. */
  it('asks for everything without a prefix when the scope is construction', () => {
    const qb = fakeQb();
    runWithRequestScope({ scopedLeadTypes: [LeadType.CONSTRUCTION] }, () => {
      applyLeadTypeScope(qb, 'lead.lead_number');
    });

    expect(qb.calls[0].clause).toContain('IS NOT NULL');
    expect(qb.calls[0].clause).toContain('!~');
  });

  /**
   * Dos aplicaciones en la misma consulta no pueden pisarse el parametro: en
   * TypeORM el segundo sobreescribe al primero en silencio y el filtro cambia
   * de significado.
   */
  it('never reuses a parameter name', () => {
    const qb = fakeQb();
    runWithRequestScope({ scopedLeadTypes: [LeadType.PLUMBING] }, () => {
      applyLeadTypeScope(qb, 'lead.lead_number');
      applyLeadTypeScope(qb, 'otherLead.lead_number');
    });

    const [first, second] = qb.calls;
    expect(Object.keys(first.parameters)).not.toEqual(Object.keys(second.parameters));
  });
});

describe('canSeeLeadNumber', () => {
  it('lets an unrestricted request see anything', () => {
    expect(canSeeLeadNumber('053R-1025')).toBe(true);
    expect(canSeeLeadNumber(null)).toBe(true);
  });

  it('allows a number of an allowed type and refuses the others', () => {
    runWithRequestScope({ scopedLeadTypes: [LeadType.PLUMBING] }, () => {
      expect(canSeeLeadNumber('032P-0825')).toBe(true);
      expect(canSeeLeadNumber('053R-1025')).toBe(false);
      expect(canSeeLeadNumber('053-1025')).toBe(false);
    });
  });

  /**
   * Un lead sin numero no pertenece a ningun tipo. Ante un tipo que no se puede
   * determinar, un usuario restringido no lo ve: lo seguro es no ensenarlo.
   */
  it('refuses a lead with no number when the request is restricted', () => {
    runWithRequestScope({ scopedLeadTypes: [LeadType.CONSTRUCTION] }, () => {
      expect(canSeeLeadNumber(null)).toBe(false);
      expect(canSeeLeadNumber('')).toBe(false);
    });
  });

  it('allows construction on a legacy number that follows no format', () => {
    runWithRequestScope({ scopedLeadTypes: [LeadType.CONSTRUCTION] }, () => {
      // getLeadTypeFromNumber manda todo lo que no lleva prefijo a CONSTRUCTION.
      expect(canSeeLeadNumber('obra vieja sin formato')).toBe(true);
    });
  });
});
