import { AsyncLocalStorage } from 'node:async_hooks';
import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { LeadType } from '../enums/lead-type.enum';
import { getLeadTypeFromNumber, leadNumberSqlFilter } from '../utils/lead-type.utils';

/**
 * El ámbito de la petición en curso.
 *
 * Existe para que una consulta pueda saber qué tipos de lead puede ver quien
 * pregunta sin que el usuario viaje como parámetro por los veintisiete métodos
 * de lectura de leads y de proyectos. Enhebrarlo a mano fue lo que se intentó
 * antes y así quedó: `projects.service.findAll(_user)` recibe el usuario y no
 * lo usa, y `scoped_company_id` llevaba escrito en su comentario que no
 * filtraba nada. Un filtro que hay que acordarse de aplicar en cada método
 * nuevo es un filtro que se escapa.
 */
export type RequestScope = {
  /** `null` es "todos los tipos", que es lo que tiene quien no está restringido. */
  scopedLeadTypes: LeadType[] | null;
};

const storage = new AsyncLocalStorage<RequestScope>();

/** Corre el manejador de la petición con el ámbito de su usuario puesto. */
export function runWithRequestScope<T>(scope: RequestScope, run: () => T): T {
  return storage.run(scope, run);
}

/**
 * Los tipos que puede ver la petición en curso, o `null` si no hay restricción.
 *
 * Fuera de una petición HTTP también devuelve `null`: ahí no hay usuario a
 * quien restringir —una herramienta de MCP, un cron, un script— y filtrar por
 * un ámbito que nadie fijó esconderÍa datos sin que nadie lo hubiera pedido. Es
 * una decisión y no un descuido: lo que entra por MCP no queda restringido.
 */
export function currentLeadTypeScope(): LeadType[] | null {
  const scope = storage.getStore();
  if (!scope) return null;
  const types = scope.scopedLeadTypes;
  if (!types || types.length === 0) return null;
  return types;
}

let scopeParamSeq = 0;

/**
 * Añade a una consulta el filtro por tipo de lead de la petición en curso.
 *
 * El tipo de un lead **no es una columna**: se deriva del patrón de su número
 * —`053R-1025` es roofing, `053P-1025` plumbing y el resto construcción—, así
 * que esto recibe la columna del número y no un alias. Un proyecto se filtra
 * por el número del lead al que pertenece, de modo que ahí la columna es la del
 * join con `lead`.
 *
 * Tiene que llamarse **después** de los demás `where` de la consulta: en
 * TypeORM `.where()` reemplaza las condiciones anteriores, así que aplicar el
 * ámbito primero y llamar luego a `.where()` lo borraría sin avisar.
 *
 * Los nombres de los parámetros son únicos por llamada porque una misma
 * consulta puede aplicar el ámbito más de una vez, y dos parámetros con el
 * mismo nombre se sobreescriben en silencio.
 */
export function applyLeadTypeScope<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  leadNumberColumn: string,
): SelectQueryBuilder<T> {
  const types = currentLeadTypeScope();
  if (!types) return qb;

  const seq = (scopeParamSeq += 1);
  const parts = types
    .map((type, index) =>
      leadNumberSqlFilter(type, leadNumberColumn, `leadTypeScope${seq}_${index}`),
    )
    .filter((part): part is NonNullable<typeof part> => part !== null);

  if (!parts.length) return qb;

  const clause = parts.map((part) => `(${part.clause})`).join(' OR ');
  const parameters = Object.assign({}, ...parts.map((part) => part.parameters)) as Record<
    string,
    string
  >;

  return qb.andWhere(`(${clause})`, parameters);
}

/**
 * Si la petición en curso puede ver un lead con este número.
 *
 * Para las lecturas por id, donde no hay consulta a la que añadir un `where`.
 * Un lead sin número no pertenece a ningún tipo, así que un usuario restringido
 * no lo ve: ante un tipo que no se puede determinar, lo seguro es no ensenarlo.
 */
export function canSeeLeadNumber(leadNumber: string | null | undefined): boolean {
  const types = currentLeadTypeScope();
  if (!types) return true;
  const type = getLeadTypeFromNumber(leadNumber);
  if (!type) return false;
  return types.includes(type);
}
