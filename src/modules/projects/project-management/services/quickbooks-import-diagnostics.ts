/**
 * Pure helpers behind the QuickBooks job import screen. Kept free of Nest and
 * TypeORM so the change-order heuristic can be unit tested on real job names.
 *
 * The problem they solve: a change order is named after its base contract
 * (`001R-0625 C01, 3324 NW 14th St ...` next to `001R-0625, 3324 NW 14th St ...`),
 * so both jobs derive the same project number and race for the same CRM
 * project. A change order is a legitimate job, not a mistake — the operator has
 * to see that the two rows are different things before linking either one.
 */

/** A leading project number, optionally followed by a correctly spelled `CO<n>`. */
const PROJECT_NUMBER =
  /^\s*\[?([0-9]{3}[A-Z]?-[0-9]{4})\]?(?:[\s,|-]*CO[\s-]*(\d+))?(?=$|[\s,|:)\]])/i;

/**
 * Change-order markers as operators actually type them right after the project
 * number: `CO1`, `CO 01`, `CO-2`, `C.O. 3` and — the form that made jobs 283 and
 * 387 collapse onto one number — `C01`, with a zero instead of the letter O.
 * Ordinals stop at two digits and must end on a word boundary, so `Corner St`
 * and street numbers such as `C0123 Main St` do not read as change orders.
 */
const CHANGE_ORDER_MARKER = /^[\s,|:;.-]*\(?C[\s.]*[O0][\s.\-#]*(\d{1,2})?\b/i;

export type QuickbooksImportJobStatus =
  | 'ok'
  | 'sin_numero'
  | 'ya_importado'
  | 'numero_en_uso'
  | 'colision';

export type QuickbooksImportJobRole =
  | 'contrato_base'
  | 'orden_de_cambio'
  | 'indeterminado';

export type ChangeOrderMarker = {
  isChangeOrder: boolean;
  changeOrderNumber: number | null;
  /** Canonical number that would keep this change order apart, when derivable. */
  suggestedProjectNumber: string | null;
};

export type QuickbooksImportJobCollision = {
  qboCustomerId: string;
  displayName: string;
  role: QuickbooksImportJobRole;
  changeOrderNumber: number | null;
  importedProjectId: number | null;
};

export type ImportJobDiagnosisInput = {
  qboCustomerId: string;
  displayName: string;
  projectNumber: string | null;
  importedProjectId: number | null;
  matchingLeads: Array<{
    leadId: number;
    projectId: number | null;
    qboCustomerId: string | null;
  }>;
};

export type ImportJobDiagnosis = {
  status: QuickbooksImportJobStatus;
  statusDetail: string;
  role: QuickbooksImportJobRole;
  changeOrderNumber: number | null;
  suggestedProjectNumber: string | null;
  collidesWith: QuickbooksImportJobCollision[];
  /** Project that already claims this number through a different QBO job. */
  conflictProjectId: number | null;
};

/** Derives the CRM project number a QuickBooks job name points at. */
export function projectNumberFromName(name: string): string | null {
  const match = String(name ?? '').match(PROJECT_NUMBER);
  if (!match) return null;
  return match[2]
    ? `${match[1]} CO${String(Number(match[2])).padStart(2, '0')}`
    : match[1];
}

/** Comparison key for project numbers written with stray spaces or `CO 01`. */
export function normalizeProjectNumber(value?: string | null): string {
  const number = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s*-\s*/g, '-');
  const changeOrder = number.match(/^(.*?)[\s,|-]*CO[\s-]*(\d+)$/i);
  if (!changeOrder) return number;
  return `${changeOrder[1].trim()} CO${Number(changeOrder[2])}`;
}

/** Reads the change-order marker out of a QuickBooks job name. */
export function detectChangeOrder(displayName: string): ChangeOrderMarker {
  const none: ChangeOrderMarker = {
    isChangeOrder: false,
    changeOrderNumber: null,
    suggestedProjectNumber: null,
  };
  const match = String(displayName ?? '').match(PROJECT_NUMBER);
  if (!match) return none;

  // Spelled the way projectNumberFromName understands it, so the derived number
  // already keeps this job apart from its base contract.
  if (match[2]) {
    return {
      isChangeOrder: true,
      changeOrderNumber: Number(match[2]),
      suggestedProjectNumber: null,
    };
  }

  const marker = displayName.slice(match[0].length).match(CHANGE_ORDER_MARKER);
  if (!marker) return none;
  const ordinal = marker[1] ? Number(marker[1]) : null;
  return {
    isChangeOrder: true,
    changeOrderNumber: ordinal,
    suggestedProjectNumber:
      ordinal == null
        ? null
        : `${match[1].toUpperCase()} CO${String(ordinal).padStart(2, '0')}`,
  };
}

/**
 * Diagnoses every job in one pass — collisions can only be seen by comparing
 * jobs against each other, so the whole list is needed at once.
 *
 * Status precedence, highest first: `ya_importado` (nothing left to decide),
 * `sin_numero` (no target can be proposed), `numero_en_uso` (the only target is
 * taken), `colision` (another job wants the same target), `ok`. `collidesWith`
 * is always filled in, whatever the status, so a blocked row still shows who it
 * competes with.
 */
export function diagnoseImportJobs(
  jobs: ImportJobDiagnosisInput[],
): ImportJobDiagnosis[] {
  const markers = jobs.map((job) => detectChangeOrder(job.displayName));
  const groups = new Map<string, number[]>();
  jobs.forEach((job, index) => {
    const key = job.projectNumber
      ? normalizeProjectNumber(job.projectNumber)
      : '';
    if (!key) return;
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });

  return jobs.map((job, index) => {
    const marker = markers[index];
    const group = job.projectNumber
      ? (groups.get(normalizeProjectNumber(job.projectNumber)) ?? [])
      : [];
    const others = group.filter((position) => position !== index);
    const groupHasChangeOrder = group.some(
      (position) => markers[position].isChangeOrder,
    );
    const role = jobRole(marker, others.length > 0, groupHasChangeOrder);

    const collidesWith = others.map((position) => ({
      qboCustomerId: jobs[position].qboCustomerId,
      displayName: jobs[position].displayName,
      role: jobRole(markers[position], true, groupHasChangeOrder),
      changeOrderNumber: markers[position].changeOrderNumber,
      importedProjectId: jobs[position].importedProjectId,
    }));

    const takenBy = job.matchingLeads.find(
      (lead) => lead.qboCustomerId && lead.qboCustomerId !== job.qboCustomerId,
    );
    // No matching lead at all is still free: importJob creates lead + project.
    const hasFreeTarget =
      job.matchingLeads.length === 0 ||
      job.matchingLeads.some(
        (lead) =>
          !lead.qboCustomerId || lead.qboCustomerId === job.qboCustomerId,
      );

    const status: QuickbooksImportJobStatus =
      job.importedProjectId != null
        ? 'ya_importado'
        : !job.projectNumber
          ? 'sin_numero'
          : !hasFreeTarget
            ? 'numero_en_uso'
            : others.length > 0
              ? 'colision'
              : 'ok';

    return {
      status,
      statusDetail: describeStatus(status, job, others.length),
      role,
      changeOrderNumber: marker.changeOrderNumber,
      suggestedProjectNumber: marker.suggestedProjectNumber,
      collidesWith,
      conflictProjectId: takenBy?.projectId ?? null,
    };
  });
}

// -----------------------------------------------------------------------------

function jobRole(
  marker: ChangeOrderMarker,
  collides: boolean,
  groupHasChangeOrder: boolean,
): QuickbooksImportJobRole {
  if (marker.isChangeOrder) return 'orden_de_cambio';
  // Two jobs on one number and no change-order marker anywhere: nothing in the
  // names says which is the contract, so do not guess.
  if (collides && !groupHasChangeOrder) return 'indeterminado';
  return 'contrato_base';
}

function describeStatus(
  status: QuickbooksImportJobStatus,
  job: ImportJobDiagnosisInput,
  collisionCount: number,
): string {
  switch (status) {
    case 'ya_importado':
      return `Already imported as CRM project ${job.importedProjectId}.`;
    case 'sin_numero':
      return 'No project number could be derived from the QuickBooks job name. Pick a CRM record or type the number by hand.';
    case 'numero_en_uso':
      return `Project number ${job.projectNumber} is already linked to a different QuickBooks job.`;
    case 'colision':
      return `${collisionCount + 1} QuickBooks jobs derive project number ${job.projectNumber}. Check which one is the base contract and which is the change order before linking.`;
    default:
      return 'Ready to import.';
  }
}
