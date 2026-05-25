import { ProjectProgressStatus } from '../../../common/enums/project-progress-status.enum';

export class ProjectHealthDto {
  projectId: number;
  projectNumber: string;
  projectName: string;
  status?: ProjectProgressStatus;
  grossMarginPercent: number;
  backlogAmount: number;
  riskLevel: 'low' | 'medium' | 'high';
  reasons: string[];
}
