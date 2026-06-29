import { LeadType } from '../enums/lead-type.enum';

/**
 * Determina el tipo de lead basándose en el formato del leadNumber.
 * 
 * Patrones:
 * - 053-1025 → CONSTRUCTION (formato estándar sin prefijo)
 * - 053R-1025 → ROOFING (prefijo 'R')
 * - 053P-1025 → PLUMBING (prefijo 'P')
 * - 053F-1025 → FENCE (prefijo 'F')
 *
 * @param leadNumber - El número de lead a analizar
 * @returns El tipo de lead o null si no se puede determinar
 */
export function getLeadTypeFromNumber(leadNumber: string | null | undefined): LeadType | null {
  if (!leadNumber || typeof leadNumber !== 'string') {
    return null;
  }

  const trimmed = leadNumber.trim().toUpperCase();
  if (!trimmed) {
    return null;
  }

  // Patrón para ROOFING: número seguido de 'R-' y más números.
  // Permite notas al final, por ejemplo: 053R-1025 (issue)
  if (/^\d+R-\d+(?:\D.*)?$/.test(trimmed)) {
    return LeadType.ROOFING;
  }

  // Patrón para PLUMBING: número seguido de 'P-' y más números.
  // Permite notas al final, por ejemplo: 053P-1025 (issue)
  if (/^\d+P-\d+(?:\D.*)?$/.test(trimmed)) {
    return LeadType.PLUMBING;
  }

  // Patrón para FENCE: número seguido de 'F-' y más números.
  // Permite notas al final, por ejemplo: 053F-1025 (issue)
  if (/^\d+F-\d+(?:\D.*)?$/.test(trimmed)) {
    return LeadType.FENCE;
  }

  // Todo lo que no sea ROOFING, PLUMBING o FENCE se considera CONSTRUCTION.
  // Esto mantiene compatibilidad con números legacy que no siguen
  // exactamente el formato NNN-NNNN.
  return LeadType.CONSTRUCTION;
}

/**
 * Filtra leads por tipo basándose en su leadNumber
 */
export function filterLeadsByType<T extends { leadNumber?: string | null }>(
  leads: T[],
  type: LeadType
): T[] {
  return leads.filter((lead) => getLeadTypeFromNumber(lead.leadNumber) === type);
}

export function matchesLeadType(
  leadNumber: string | null | undefined,
  leadType: LeadType | undefined,
): boolean {
  if (!leadType) return true;
  return getLeadTypeFromNumber(leadNumber) === leadType;
}

export type LeadNumberSqlFilter = {
  clause: string;
  parameters: Record<string, string>;
};

export function leadNumberSqlFilter(
  leadType: LeadType | undefined,
  column: string,
  paramKey: string,
): LeadNumberSqlFilter | null {
  if (!leadType) return null;

  if (leadType === LeadType.ROOFING) {
    return {
      clause: `${column} ~ :${paramKey}`,
      parameters: { [paramKey]: '^[0-9]+R-[0-9]+([^0-9].*)?$' },
    };
  }

  if (leadType === LeadType.PLUMBING) {
    return {
      clause: `${column} ~ :${paramKey}`,
      parameters: { [paramKey]: '^[0-9]+P-[0-9]+([^0-9].*)?$' },
    };
  }

  if (leadType === LeadType.FENCE) {
    return {
      clause: `${column} ~ :${paramKey}`,
      parameters: { [paramKey]: '^[0-9]+F-[0-9]+([^0-9].*)?$' },
    };
  }

  return {
    clause: `${column} IS NOT NULL AND ${column} !~ :${paramKey}`,
    parameters: { [paramKey]: '^[0-9]+[RPF]-[0-9]+([^0-9].*)?$' },
  };
}



