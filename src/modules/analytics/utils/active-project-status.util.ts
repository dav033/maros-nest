import { ProjectProgressStatus } from '../../../common/enums/project-progress-status.enum';

const INACTIVE_STATUSES: ReadonlySet<string> = new Set([
  ProjectProgressStatus.COMPLETED,
  ProjectProgressStatus.LOST,
  ProjectProgressStatus.POSTPONED,
]);

export function isActiveProjectStatus(status?: string | null): boolean {
  if (!status) return true;
  return !INACTIVE_STATUSES.has(status);
}
