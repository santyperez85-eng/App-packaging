import { AlertSeverity, AlertStatus, ProjectItemStatus, ProjectStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { isMockPreviewEnabled, mockData } from "@/server/mock-data";
import { projectsRepository } from "@/server/repositories/projects-repository";
import { alertsRepository } from "@/server/repositories/alerts-repository";
import {
  LIFECYCLE_MILESTONE_INCLUDE,
  buildMilestones,
  type LifecycleMilestoneStatus
} from "@/server/services/project-item-lifecycle-service";

// Los milestones que cuentan como "avance real" para el pipeline.
const PIPELINE_MILESTONES = [
  { key: "expectation", label: "Expectativa PM" },
  { key: "code_request", label: "Pedido de código" },
  { key: "pre_sap_structure", label: "Estructura pre-SAP" },
  { key: "formal_material", label: "Material formal" },
  { key: "documentation_approval", label: "Documentación" }
] as const;

type PipelineStageCounts = {
  key: string;
  label: string;
  ready: number;
  partial: number;
  missing: number;
  notApplicable: number;
  total: number;
  /** null cuando el hito no aplica a ningun componente (ej. SAP fuera de fase). */
  coveragePercent: number | null;
};

function bucketFor(status: LifecycleMilestoneStatus) {
  if (status === "ready") {
    return "ready" as const;
  }

  if (status === "partial" || status === "manual_review") {
    return "partial" as const;
  }

  if (status === "not_required" || status === "not_integrated") {
    return "notApplicable" as const;
  }

  return "missing" as const;
}

export const dashboardService = {
  async getExecutiveSnapshot() {
    if (isMockPreviewEnabled()) {
      return mockData.dashboard;
    }

    const [totalProjects, activeProjects, blockedProjects, totalItems, readyItems, openAlerts, criticalAlerts, atRiskProjects] =
      await Promise.all([
        prisma.project.count(),
        prisma.project.count({ where: { status: ProjectStatus.ACTIVE } }),
        prisma.project.count({ where: { status: ProjectStatus.BLOCKED } }),
        prisma.projectItem.count(),
        prisma.projectItem.count({ where: { status: ProjectItemStatus.READY } }),
        prisma.alert.count({ where: { status: AlertStatus.OPEN } }),
        prisma.alert.count({
          where: {
            status: AlertStatus.OPEN,
            severity: AlertSeverity.CRITICAL
          }
        }),
        projectsRepository.list({
          OR: [{ healthScore: { lt: 60 } }, { alerts: { some: { status: AlertStatus.OPEN, severity: AlertSeverity.CRITICAL } } }]
        })
      ]);

    const recentAlerts = await alertsRepository.list({
      status: AlertStatus.OPEN
    });

    const pipeline = await this.getPipelineSnapshot();

    return {
      totals: {
        totalProjects,
        activeProjects,
        blockedProjects,
        totalItems,
        readyItems,
        openAlerts,
        criticalAlerts
      },
      atRiskProjects: atRiskProjects.slice(0, 5),
      recentAlerts: recentAlerts.slice(0, 8),
      pipeline
    };
  },

  /**
   * Pipeline operativo: cuantos componentes cubrieron cada milestone.
   * Reutiliza buildMilestones del lifecycle para no duplicar la semantica.
   * Sin `projectId` agrega todos los proyectos (vista ejecutiva); con
   * `projectId` acota el mismo calculo a un proyecto.
   */
  async getPipelineSnapshot(options?: { projectId?: string; blockedItemsLimit?: number }) {
    // Sin DATABASE_URL (preview de UI) no hay nada que consultar.
    if (isMockPreviewEnabled()) {
      return mockData.dashboard.pipeline;
    }

    const items = await prisma.projectItem.findMany({
      where: options?.projectId ? { projectId: options.projectId } : undefined,
      include: LIFECYCLE_MILESTONE_INCLUDE
    });

    const stages: PipelineStageCounts[] = PIPELINE_MILESTONES.map((stage) => ({
      key: stage.key,
      label: stage.label,
      ready: 0,
      partial: 0,
      missing: 0,
      notApplicable: 0,
      total: 0,
      coveragePercent: 0
    }));
    const stageByKey = new Map(stages.map((stage) => [stage.key, stage]));
    const blockedItems: Array<{
      id: string;
      itemKey: string;
      name: string;
      projectCode: string;
      readinessScore: number;
      status: string;
      firstMissingMilestone: string;
    }> = [];

    for (const item of items) {
      const milestones = buildMilestones(item);

      for (const milestone of milestones) {
        const stage = stageByKey.get(milestone.key);

        if (!stage) {
          continue;
        }

        stage[bucketFor(milestone.status)] += 1;
        stage.total += 1;
      }

      // Primer milestone faltante en orden operativo: donde esta trabado el item.
      const firstMissing = milestones
        .slice()
        .sort((left, right) => left.operationalOrder - right.operationalOrder)
        .find((milestone) => bucketFor(milestone.status) === "missing");

      if (firstMissing) {
        blockedItems.push({
          id: item.id,
          itemKey: item.itemKey,
          name: item.name,
          projectCode: item.project.code,
          readinessScore: item.readinessScore,
          status: item.status,
          firstMissingMilestone: firstMissing.label
        });
      }
    }

    for (const stage of stages) {
      // La cobertura se mide sobre los componentes a los que el milestone aplica.
      // Si no aplica a ninguno, no hay porcentaje que reportar (no es 0% de avance).
      const applicable = stage.total - stage.notApplicable;
      stage.coveragePercent = applicable > 0 ? Math.round((stage.ready / applicable) * 100) : null;
    }

    return {
      itemsEvaluated: items.length,
      stages,
      blockedItems: blockedItems
        .sort((left, right) => left.readinessScore - right.readinessScore)
        .slice(0, options?.blockedItemsLimit ?? 8)
    };
  }
};
