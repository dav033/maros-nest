import { Injectable } from '@nestjs/common';
import { LeadType } from '../../../common/enums/lead-type.enum';
import { ProjectProgressStatus } from '../../../common/enums/project-progress-status.enum';
import { ProjectsService } from '../../projects/project-management/services/projects.service';
import { ProjectHealthDto } from '../dto/project-health.dto';
import { isActiveProjectStatus } from '../utils/active-project-status.util';

/** Lo que esta pantalla necesita del bloque financiero que arma `findAllFinancials`. */
type ProjectFinancialFigures = {
  found?: boolean;
  estimatedAmount?: number;
  invoicedAmount?: number;
  grossProfit?: number;
};

@Injectable()
export class AnalyticsProjectsService {
  private readonly maxProjectsToAnalyze = 15;
  private readonly lowMarginThreshold = 12;
  private readonly highBacklogThreshold = 10_000;

  constructor(private readonly projectsService: ProjectsService) {}

  /**
   * Antes esto pedía a QuickBooks un resumen de costos por proyecto, de a tres a la vez:
   * quince proyectos eran cinco tandas de consultas pesadas y cincuenta segundos de
   * espera con la pantalla en blanco, cada vez que el caché se enfriaba.
   *
   * Las mismas cifras ya salen de `findAllFinancials`, que la lista de proyectos calcula
   * para los 109 de una sola pasada en unos nueve segundos y deja en caché. Se reusa esa:
   * el primer visitante espera lo que ya iba a esperar al abrir Projects, y el resto no
   * espera nada.
   */
  async getProjectHealth(leadType?: LeadType): Promise<ProjectHealthDto[]> {
    const projects = await this.projectsService.findAnalyticsProjectSeed(300, leadType);
    const activeProjects = projects
      .filter((project) => isActiveProjectStatus(project.projectProgressStatus))
      .filter((project) => Boolean(project.leadNumber))
      .slice(0, this.maxProjectsToAnalyze);

    if (activeProjects.length === 0) return [];

    const financials = await this.projectsService.findAllFinancials();
    const byProjectId = new Map(
      financials.map((entry) => [entry.id, entry.financial as ProjectFinancialFigures | null]),
    );

    return activeProjects
      .map((project) => this.buildProjectHealth(project, byProjectId.get(project.id) ?? null))
      .filter((item): item is ProjectHealthDto => Boolean(item && item.reasons.length > 0));
  }

  private buildProjectHealth(
    project: {
      id: number;
      projectProgressStatus?: ProjectProgressStatus;
      leadNumber?: string;
      leadName?: string;
    },
    financial: ProjectFinancialFigures | null,
  ): ProjectHealthDto | null {
    const projectNumber = String(project.leadNumber ?? '');
    if (!projectNumber) return null;

    // Sin cifras no se puede decir nada del proyecto. Callarlo es lo correcto: un
    // margen de 0% inventado lo pintaría en rojo como si estuviera en problemas.
    if (!financial || financial.found === false) return null;

    const invoiced = Number(financial.invoicedAmount) || 0;
    const grossProfit = Number(financial.grossProfit) || 0;
    const margin = invoiced === 0 ? 0 : (grossProfit / invoiced) * 100;

    // El valor del contrato es el estimado, y si el proyecto no tiene ninguno, lo
    // facturado. Es el mismo número que la columna CONTRACT de la lista de proyectos:
    // antes esta pantalla prefería el estimado *aceptado*, así que un proyecto con
    // varios estimados podía mostrar aquí un backlog distinto al de la lista.
    const estimated = Number(financial.estimatedAmount) || 0;
    const contractValue = estimated > 0 ? estimated : invoiced;
    const backlog = Math.max(0, contractValue - invoiced);

    const reasons: string[] = [];
    if (margin < this.lowMarginThreshold) {
      reasons.push(`Low margin (${margin.toFixed(1)}%)`);
    }
    if (backlog > this.highBacklogThreshold) {
      reasons.push(`High backlog (${backlog.toFixed(2)})`);
    }

    return {
      projectId: project.id,
      projectNumber,
      projectName: project.leadName ?? projectNumber,
      status: project.projectProgressStatus,
      grossMarginPercent: margin,
      backlogAmount: backlog,
      riskLevel: this.resolveRiskLevel(margin, backlog),
      reasons,
    } satisfies ProjectHealthDto;
  }

  private resolveRiskLevel(
    margin: number,
    backlog: number,
  ): 'low' | 'medium' | 'high' {
    if (margin < 8 || backlog > this.highBacklogThreshold * 2) {
      return 'high';
    }
    if (margin < this.lowMarginThreshold || backlog > this.highBacklogThreshold) {
      return 'medium';
    }
    return 'low';
  }
}
