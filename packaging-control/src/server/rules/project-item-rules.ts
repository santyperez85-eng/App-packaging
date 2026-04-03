import {
  AlertSeverity,
  AlertStatus,
  CheckStatus,
  MoondeskTaskStatus,
  MoondeskTaskType,
  Prisma,
  ProjectItemStatus
} from "@prisma/client";

import { clampScore, compact } from "@/lib/utils";

export type ProjectItemRulesRecord = Prisma.ProjectItemGetPayload<{
  include: {
    materialMaster: true;
    alerts: true;
    technicalChecks: true;
    moondeskTasks: {
      include: {
        documents: true;
        reviews: true;
      };
    };
  };
}>;

export type RuleAlertSeed = {
  ruleCode: string;
  type: string;
  title: string;
  message: string;
  severity: AlertSeverity;
};

export function evaluateProjectItemRules(
  item: ProjectItemRulesRecord,
  today = new Date()
): {
  status: ProjectItemStatus;
  readinessScore: number;
  activeAlerts: RuleAlertSeed[];
  blockers: string[];
} {
  const blockingChecks = item.technicalChecks.filter(
    (check) => check.isBlocking && check.status !== CheckStatus.PASSED
  );
  const designTasks = item.moondeskTasks.filter((task) => task.taskType === MoondeskTaskType.DESIGN_REQUEST);
  const reviewTasks = item.moondeskTasks.filter((task) => task.taskType === MoondeskTaskType.REVIEW_REQUEST);
  const hasApprovedDocument =
    !item.requiresApprovedDocument ||
    item.moondeskTasks.some(
      (task) =>
        task.approvedVersionAvailable ||
        task.documents.some((document) => document.approved)
    );
  const missingTechDocs = compact([
    item.requiresTechnicalDocs && item.materialMaster && !item.materialMaster.drawingCode ? "plano" : null,
    item.requiresTechnicalDocs && item.materialMaster && !item.materialMaster.specificationCode
      ? "especificacion"
      : null,
    item.requiresTechnicalDocs && item.materialMaster && !item.materialMaster.technicalSheetCode
      ? "ficha tecnica"
      : null
  ]);
  const designCompletedWithoutReview =
    designTasks.some((task) => task.taskStatus === MoondeskTaskStatus.COMPLETED) && reviewTasks.length === 0;
  const overdueReview = reviewTasks.some(
    (task) =>
      Boolean(task.dueDate) &&
      task.dueDate !== null &&
      task.dueDate < today &&
      task.taskStatus !== MoondeskTaskStatus.COMPLETED
  );

  const activeAlerts = compact<RuleAlertSeed>([
    item.requiresMaterialCode && !item.materialMaster
      ? {
          ruleCode: "BOM_COMPONENT_WITHOUT_MATERIAL",
          type: "MISSING_MATERIAL",
          title: "BOM sin material asociado",
          message: `El item ${item.name} requiere material y todavia no tiene material master vinculado.`,
          severity: AlertSeverity.CRITICAL
        }
      : null,
    item.materialMaster && missingTechDocs.length
      ? {
          ruleCode: "MATERIAL_MISSING_TECH_DOCS",
          type: "MISSING_TECH_DOC",
          title: "Documentacion tecnica incompleta",
          message: `El material ${item.materialMaster.materialCode} no tiene ${missingTechDocs.join(", ")}.`,
          severity: missingTechDocs.length > 1 ? AlertSeverity.CRITICAL : AlertSeverity.WARNING
        }
      : null,
    designCompletedWithoutReview
      ? {
          ruleCode: "DESIGN_WITHOUT_REVIEW",
          type: "MISSING_REVIEW_TASK",
          title: "Diseno completado sin revision",
          message: `La tarea de diseno de ${item.name} esta completada y no existe tarea de revision asociada.`,
          severity: AlertSeverity.WARNING
        }
      : null,
    overdueReview
      ? {
          ruleCode: "OVERDUE_REVIEW",
          type: "REVIEW_OVERDUE",
          title: "Revision vencida",
          message: `La revision de ${item.name} esta vencida y sigue abierta.`,
          severity: AlertSeverity.CRITICAL
        }
      : null,
    item.requiresApprovedDocument && !hasApprovedDocument
      ? {
          ruleCode: "APPROVED_DOCUMENT_MISSING",
          type: "MISSING_APPROVED_DOCUMENT",
          title: "Falta documento aprobado",
          message: `No existe documento aprobado de Moondesk para ${item.name}.`,
          severity: AlertSeverity.WARNING
        }
      : null,
    blockingChecks.length
      ? {
          ruleCode: "BLOCKING_CHECKS_PENDING",
          type: "BLOCKING_CHECK",
          title: "Checks bloqueantes pendientes",
          message: `${blockingChecks.length} check(s) bloqueante(s) impiden liberar ${item.name}.`,
          severity: AlertSeverity.CRITICAL
        }
      : null
  ]);

  const generatedCriticalCount = activeAlerts.filter((alert) => alert.severity === AlertSeverity.CRITICAL).length;
  const generatedWarningCount = activeAlerts.filter((alert) => alert.severity === AlertSeverity.WARNING).length;
  const manualCriticalCount = item.alerts.filter(
    (alert) =>
      alert.status === AlertStatus.OPEN &&
      alert.severity === AlertSeverity.CRITICAL &&
      !activeAlerts.some((candidate) => candidate.ruleCode === alert.ruleCode)
  ).length;
  const blockers = compact([
    item.requiresMaterialCode && !item.materialMaster ? "missing_material_code" : null,
    blockingChecks.length ? "blocking_checks" : null,
    item.requiresApprovedDocument && !hasApprovedDocument ? "approved_document_missing" : null,
    missingTechDocs.length ? "technical_documents_missing" : null,
    overdueReview ? "review_overdue" : null,
    manualCriticalCount ? "critical_alerts_open" : null
  ]);

  let status: ProjectItemStatus = ProjectItemStatus.READY;

  if (item.requiresMaterialCode && !item.materialMaster) {
    status = ProjectItemStatus.WAITING_CODE;
  } else if (blockingChecks.length || overdueReview || generatedCriticalCount + manualCriticalCount > 0) {
    status = ProjectItemStatus.BLOCKED;
  } else if (missingTechDocs.length || (item.requiresApprovedDocument && !hasApprovedDocument)) {
    status = ProjectItemStatus.WAITING_DOCS;
  } else if (designTasks.length || reviewTasks.length) {
    status = ProjectItemStatus.IN_PROGRESS;
  }

  const readinessScore = clampScore(
    100 - generatedCriticalCount * 30 - manualCriticalCount * 20 - generatedWarningCount * 10 - blockingChecks.length * 10
  );

  return {
    status,
    readinessScore,
    activeAlerts,
    blockers
  };
}
