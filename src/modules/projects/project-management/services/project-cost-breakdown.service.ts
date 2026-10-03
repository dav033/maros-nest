import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../../../../entities/project.entity';
import { ResourceNotFoundException } from '../../../../common/exceptions/resource-not-found.exception';
import { QuickbooksJobCostingService } from '../../../quickbooks/services/job-costing/quickbooks-job-costing.service';
import { canSeeLeadNumber } from '../../../../common/auth/request-scope';
import type {
  QboJobCostBreakdown,
  QboJobCostExpenseBreakdown,
} from '../../../quickbooks/services/job-costing/quickbooks-job-costing.types';

/**
 * Las dos categorias que la ficha del proyecto compara contra su pronostico.
 *
 * Se reconocen por el nombre de la cuenta y no por su Id, porque el Id es de
 * este realm de QuickBooks y un fichero nuevo lo cambiaria sin avisar. Se
 * comprobo contra el plan de cuentas en uso: hay exactamente una cuenta de cada
 * cosa — "50400 Construction Materials Costs" (212.344,93 en el ano) y
 * "53600 Subcontractors Expense" (470.130,95), las dos en COGS.
 */
const CATEGORY_MATCHERS: Array<{ key: ProjectCostCategoryKey; test: RegExp }> = [
  { key: 'material', test: /construction\s+materials|\b50400\b/i },
  { key: 'subcontractor', test: /subcontractor|\b53600\b/i },
];

export type ProjectCostCategoryKey = 'material' | 'subcontractor';

export type ProjectCostVendor = {
  id?: string;
  name: string;
  /** Pagado en efectivo, que es la cifra que se compara con el pronostico. */
  paid: number;
  openAp: number;
  committedPo: number;
  total: number;
  transactionCount: number;
};

export type ProjectCostCategory = {
  key: ProjectCostCategoryKey;
  /** El nombre de la cuenta tal y como lo tiene QuickBooks. */
  accountName: string | null;
  paid: number;
  openAp: number;
  committedPo: number;
  total: number;
  /** Lo que se espera acabar pagando. `null` es "nadie lo escribio", no 0. */
  forecast: number | null;
  /**
   * `paid - forecast`, o `null` si no hay pronostico. Positivo es pasarse.
   * Se calcula aqui para que la pantalla no reste dos cifras que podrian venir
   * de bases distintas.
   */
  overrun: number | null;
  vendors: ProjectCostVendor[];
};

export type ProjectCostBreakdown = {
  projectId: number;
  leadNumber: string | null;
  qboCustomerId: string | null;
  /** QuickBooks no reconocio el proyecto: no hay cifras que ensenar. */
  found: boolean;
  /** Coste total del proyecto, de todas las cuentas y no solo de estas dos. */
  totalPaid: number;
  totalJobCost: number;
  categories: ProjectCostCategory[];
  /**
   * Lo pagado que no cae en ninguna de las dos categorias: permisos, alquiler
   * de equipo, planos. Va aparte y no escondido, porque si no la pantalla
   * ensenaria dos cifras que no suman el coste del proyecto y nadie sabria por
   * que.
   */
  otherPaid: number;
  forecastUpdatedAt: string | null;
};

/**
 * El coste de un proyecto por categoria, contra lo que se espera que acabe
 * costando.
 *
 * La parte real sale del motor de job costing, que es el que cuadra al centimo
 * con el Profit and Loss de QuickBooks en las 82 obras; aqui solo se escoge y
 * se recorta. La parte esperada sale de `projects`, porque es un juicio de
 * alguien y no hay nada en QuickBooks que la implique.
 */
@Injectable()
export class ProjectCostBreakdownService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    private readonly jobCosting: QuickbooksJobCostingService,
  ) {}

  async getBreakdown(projectId: number): Promise<ProjectCostBreakdown> {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
      relations: ['lead'],
    });
    // Igual que el reporte: fuera del ambito no existe, y aqui se devuelve el
    // coste de la obra.
    if (!project || !canSeeLeadNumber(project.lead?.leadNumber)) {
      throw new ResourceNotFoundException(
        `Project not found with id: ${projectId}`,
      );
    }

    const leadNumber = project.lead?.leadNumber ?? null;
    const forecast = {
      material: toAmount(project.forecastMaterialCost),
      subcontractor: toAmount(project.forecastSubcontractorCost),
    };

    // Ni adjuntos ni reportes: esta pantalla solo necesita las cifras, y con
    // ellos la respuesta del job 032P-0825 pasa de unos kilobytes a 367.
    const summary = await this.jobCosting.getProjectJobCostSummary({
      ...(leadNumber && { projectNumber: leadNumber }),
      ...(project.qboCustomerId && { qboCustomerId: project.qboCustomerId }),
      includeAttachments: false,
      includeReports: false,
    });

    const buckets = summary.expenseBreakdown ?? [];
    const categories = CATEGORY_MATCHERS.map(({ key, test }) =>
      this.buildCategory(
        key,
        buckets.filter((bucket) => test.test(bucket.name)),
        forecast[key],
      ),
    );

    const totalPaid = summary.summary.cashOutPaid;
    const categorisedPaid = categories.reduce(
      (sum, category) => sum + category.paid,
      0,
    );

    return {
      projectId: project.id,
      leadNumber,
      qboCustomerId: summary.project.qboCustomerId || project.qboCustomerId || null,
      found: summary.project.foundInQuickBooks,
      totalPaid,
      totalJobCost: summary.summary.totalJobCost,
      categories,
      otherPaid: round(totalPaid - categorisedPaid),
      forecastUpdatedAt: project.forecastUpdatedAt
        ? project.forecastUpdatedAt.toISOString()
        : null,
    };
  }

  /**
   * Varias cuentas podrian caer en la misma categoria (una cuenta hija de
   * materiales, por ejemplo), asi que se suman en vez de quedarse con la
   * primera, y los proveedores se funden por nombre: el mismo proveedor en dos
   * cuentas de la misma categoria es una fila, no dos.
   */
  private buildCategory(
    key: ProjectCostCategoryKey,
    buckets: QboJobCostExpenseBreakdown[],
    forecast: number | null,
  ): ProjectCostCategory {
    const vendors = new Map<string, ProjectCostVendor>();
    for (const bucket of buckets) {
      for (const vendor of bucket.vendors) {
        const vendorKey = vendor.id ?? vendor.name;
        const existing = vendors.get(vendorKey);
        if (existing) {
          mergeVendor(existing, vendor);
          continue;
        }
        vendors.set(vendorKey, {
          ...(vendor.id && { id: vendor.id }),
          name: vendor.name,
          paid: vendor.cashOutPaid,
          openAp: vendor.openAp,
          committedPo: vendor.committedPo,
          total: vendor.totalJobCost,
          transactionCount: vendor.transactionCount,
        });
      }
    }

    const paid = round(buckets.reduce((sum, bucket) => sum + bucket.cashOutPaid, 0));

    return {
      key,
      accountName: buckets[0]?.name ?? null,
      paid,
      openAp: round(buckets.reduce((sum, bucket) => sum + bucket.openAp, 0)),
      committedPo: round(
        buckets.reduce((sum, bucket) => sum + bucket.committedPo, 0),
      ),
      total: round(buckets.reduce((sum, bucket) => sum + bucket.totalJobCost, 0)),
      forecast,
      overrun: forecast === null ? null : round(paid - forecast),
      vendors: [...vendors.values()]
        .map((vendor) => ({
          ...vendor,
          paid: round(vendor.paid),
          openAp: round(vendor.openAp),
          committedPo: round(vendor.committedPo),
          total: round(vendor.total),
        }))
        .sort((a, b) => b.paid - a.paid || b.total - a.total),
    };
  }
}

function mergeVendor(target: ProjectCostVendor, source: QboJobCostBreakdown): void {
  target.paid += source.cashOutPaid;
  target.openAp += source.openAp;
  target.committedPo += source.committedPo;
  target.total += source.totalJobCost;
  target.transactionCount += source.transactionCount;
}

/** `numeric` vuelve de Postgres como cadena; NULL se conserva como null. */
function toAmount(value: string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
