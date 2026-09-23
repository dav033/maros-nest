/**
 * Guessing which project an invoice belongs to. Lead numbers look like
 * `050P-0826` / `045-0726` (sequence, optional P for plumbing, dash, MMYY);
 * invoices and their file names usually only carry the `050P` part.
 */

const PREFIX_IN_TEXT = /(?:^|[^0-9A-Z])(\d{3}P?)(?=[-_ .]|$)/i;
const FULL_NUMBER_IN_TEXT = /(?:^|[^0-9A-Z])(\d{3}P?-\d{4})(?=[^0-9]|$)/i;

export interface ProjectNumberResolution {
  projectNumber: string | null;
  warning: string | null;
}

export function projectNumberCandidates(input: {
  extracted: string | null;
  fileName: string;
}): string[] {
  const candidates: string[] = [];
  const push = (value: string | null | undefined) => {
    const normalized = value?.trim().toUpperCase();
    if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
  };
  if (input.extracted) {
    push(FULL_NUMBER_IN_TEXT.exec(input.extracted)?.[1]);
    push(PREFIX_IN_TEXT.exec(input.extracted)?.[1]);
    push(input.extracted);
  }
  push(FULL_NUMBER_IN_TEXT.exec(input.fileName)?.[1]);
  push(PREFIX_IN_TEXT.exec(input.fileName)?.[1]);
  return candidates;
}

export function resolveProjectNumber(
  candidates: string[],
  leadNumbers: string[],
): ProjectNumberResolution {
  if (candidates.length === 0) {
    return {
      projectNumber: null,
      warning: 'No project number was found on the invoice; pick the project manually.',
    };
  }
  const known = leadNumbers.map((value) => value.trim().toUpperCase());
  for (const candidate of candidates) {
    const exact = known.indexOf(candidate);
    if (exact !== -1) return { projectNumber: leadNumbers[exact], warning: null };

    const prefixed = known
      .map((value, index) => ({ value, index }))
      .filter(({ value }) => value.startsWith(`${candidate}-`));
    if (prefixed.length === 1) {
      return { projectNumber: leadNumbers[prefixed[0].index], warning: null };
    }
    if (prefixed.length > 1) {
      const options = prefixed.map(({ index }) => leadNumbers[index]).join(', ');
      return {
        projectNumber: null,
        warning: `Project number ${candidate} matches several projects (${options}); pick the right one.`,
      };
    }
  }
  return {
    projectNumber: null,
    warning: `No project matched "${candidates[0]}"; pick the project manually.`,
  };
}
