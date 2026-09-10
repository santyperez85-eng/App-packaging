
import { AlertStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { isMockPreviewEnabled, mockData } from "@/server/mock-data";
import { checklistMaterialCode, evaluateClosureChecklist } from "@/server/rules/closure-checklist";
import { approvedDocumentsService } from "@/server/services/approved-documents-service";
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
  /**
   * Antiguedad del ultimo corte del maestro de SAP. Se expone en el dashboard
   * porque el dato no se sincroniza en continuo: sin la fecha a la vista, "no
   * esta en SAP" se lee igual que "el corte quedo viejo".
   */
  async getSapFreshness() {
    if (isMockPreviewEnabled()) {
      return null;
    }

    const snapshot = await prisma.sapMasterSnapshot.findFirst({ orderBy: [{ dataDate: "desc" }] });

    if (!snapshot) {
      return null;
    }

    const ageInDays = Math.max(
      0,
      Math.floor((Date.now() - snapshot.dataDate.getTime()) / (24 * 60 * 60 * 1000))
    );

    return {
      dataDate: snapshot.dataDate.toISOString(),
      importedAt: snapshot.importedAt.toISOString(),
      sourceFileName: snapshot.sourceFileName,
      materialCount: snapshot.materialCount,
      currentCount: snapshot.currentCount,
      discontinuedCount: snapshot.discontinuedCount,
      erroredCount: snapshot.erroredCount,
      ageInDays,
      // Los cortes son mensuales: pasado ese plazo el dato deja de ser confiable
      // para decidir si algo esta formalizado.
      stale: ageInDays > 45
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
    // Los documentos publicados se buscan por codigo de material, en una sola
    // consulta para todos los componentes.
    const approvedDocs = await approvedDocumentsService.getByMaterialCodes(
      items.map((item) => checklistMaterialCode(item)).filter((code): code is string => Boolean(code))
    );
    // "Que falta" en lugar de "donde esta trabado": el proceso no es secuencial,
    // asi que senalar un unico punto de bloqueo describiria mal la situacion.
    const blockedItems: Array<{
      id: string;
      itemKey: string;
      name: string;
      projectCode: string;
      readinessScore: number;
      status: string;
      missingRequirements: string[];
      atRiskRequirements: string[];
      readyToClose: boolean;
    }> = [];
    let readyToCloseCount = 0;

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

      // Que le falta al componente para poder cerrarse, sin asumir un orden.
      const materialCode = checklistMaterialCode(item);
      const checklist = evaluateClosureChecklist(
        item,
        materialCode ? approvedDocs.get(materialCode.toUpperCase()) ?? null : null
      );

      if (checklist.readyToClose) {
        readyToCloseCount += 1;
        continue;
      }

      blockedItems.push({
        id: item.id,
        itemKey: item.itemKey,
        name: item.name,
        projectCode: item.project.code,
        readinessScore: item.readinessScore,
        status: item.status,
        missingRequirements: checklist.missing,
        atRiskRequirements: checklist.atRisk,
        readyToClose: false
      });
    }

    for (const stage of stages) {
      // La cobertura se mide sobre los componentes a los que el milestone aplica.
      // Si no aplica a ninguno, no hay porcentaje que reportar (no es 0% de avance).
      const applicable = stage.total - stage.notApplicable;
      stage.coveragePercent = applicable > 0 ? Math.round((stage.ready / applicable) * 100) : null;
    }

    return {
      itemsEvaluated: items.length,
      readyToClose: readyToCloseCount,
      stages,
      blockedItems: blockedItems
        .sort((left, right) => left.readinessScore - right.readinessScore)
        .slice(0, options?.blockedItemsLimit ?? 8)
    };
  }
};
