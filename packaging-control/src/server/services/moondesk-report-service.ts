import {
  ComponentSlot,
  DocumentType,
  MoondeskTaskStatus,
  MoondeskTaskType,
  Prisma,
  ReviewDecision
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import {
  buildMoondeskReport,
  excelSerialToDate,
  type MoondeskApprovalState,
  type MoondeskTaskCandidate
} from "@/server/etl/moondesk-tasks-report";
import {
  isReviewerRole,
  parseTasksTimes,
  parseUsersTasksTimes,
  type MoondeskTaskTiming,
  type MoondeskUserStep
} from "@/server/etl/moondesk-times-report";
import { projectItemEvidencesRepository } from "@/server/repositories/project-item-evidences-repository";
import { projectItemsService } from "@/server/services/project-items-service";

const DOC_TYPE_MAP: Array<{ match: string[]; type: DocumentType }> = [
  { match: ["plano"], type: DocumentType.DRAWING },
  { match: ["especificacion", "ft"], type: DocumentType.SPECIFICATION },
  { match: ["estuche", "etiqueta", "prospecto", "aluminio", "frasco", "pomo", "folia"], type: DocumentType.ARTWORK }
];

function documentTypeFor(rawType: string | null): DocumentType {
  const normalized = (rawType ?? "").toLowerCase();
  const found = DOC_TYPE_MAP.find((entry) => entry.match.some((token) => normalized.includes(token)));

  return found?.type ?? DocumentType.OTHER;
}

function reviewDecisionFor(state: MoondeskApprovalState): ReviewDecision {
  switch (state) {
    case "APPROVED":
      return ReviewDecision.APPROVED;
    case "CHANGES_REQUESTED":
      return ReviewDecision.CHANGES_REQUESTED;
    case "IN_REVIEW":
      return ReviewDecision.PENDING;
    default:
      return ReviewDecision.PENDING;
  }
}

function taskStatusFor(state: MoondeskApprovalState): MoondeskTaskStatus {
  return state === "APPROVED" ? MoondeskTaskStatus.COMPLETED : MoondeskTaskStatus.IN_PROGRESS;
}

// Identificador estable derivado del contenido del reporte, para que reimportar
// el mismo reporte actualice la tarea en vez de duplicarla.
function externalTaskId(projectCode: string, candidate: MoondeskTaskCandidate) {
  return `moondesk-report:${slugify(projectCode)}:${candidate.row.taskNumber}:${slugify(
    candidate.row.documentNumber ?? candidate.row.materialCode ?? candidate.componentSlot
  )}`;
}

function evidenceSourceRecordKey(projectCode: string, candidate: MoondeskTaskCandidate) {
  return `moondesk:${slugify(projectCode)}:${slugify(candidate.row.materialCode ?? candidate.componentSlot)}:${slugify(
    candidate.row.documentType ?? "doc"
  )}:${candidate.row.taskNumber ?? "task"}`;
}

type ApplyMoondeskReportParams = {
  workbookPath: string;
  projectCode: string;
  projectToken: string;
  sheetName?: string;
  excludeProjectTokens?: string[];
};

export const moondeskReportService = {
  async applyReport(params: ApplyMoondeskReportParams) {
    const project = await prisma.project.findUnique({
      where: { code: params.projectCode },
      include: {
        projectItems: {
          select: { id: true, itemKey: true, componentSlot: true, name: true }
        }
      }
    });

    if (!project) {
      throw new Error(`Project not found: ${params.projectCode}`);
    }

    const expectedComponentSlots = project.projectItems.map((item) => item.componentSlot);
    const { candidates, diagnostics } = buildMoondeskReport({
      workbookPath: params.workbookPath,
      projectToken: params.projectToken,
      expectedComponentSlots,
      sheetName: params.sheetName,
      excludeProjectTokens: params.excludeProjectTokens
    });

    // Un item por slot: si el PM repitiera slot, tomamos el primero deterministicamente.
    const itemBySlot = new Map<ComponentSlot, { id: string; itemKey: string; name: string }>();
    for (const item of project.projectItems) {
      if (!itemBySlot.has(item.componentSlot)) {
        itemBySlot.set(item.componentSlot, { id: item.id, itemKey: item.itemKey, name: item.name });
      }
    }

    const applied: Array<{
      projectItemId: string;
      itemKey: string;
      componentSlot: ComponentSlot;
      materialCode: string | null;
      approvalState: MoondeskApprovalState;
      approved: boolean;
    }> = [];
    const touchedItemIds = new Set<string>();

    for (const candidate of candidates) {
      const item = itemBySlot.get(candidate.componentSlot);

      if (!item) {
        continue;
      }

      const taskStatus = taskStatusFor(candidate.approvalState);
      const approvedAt = candidate.approved ? excelSerialToDate(candidate.row.approvalDateSerial) : null;
      const externalId = externalTaskId(project.code, candidate);
      const documentType = documentTypeFor(candidate.row.documentType);

      const task = await prisma.moondeskTask.upsert({
        where: { externalTaskId: externalId },
        update: {
          projectItemId: item.id,
          taskType: MoondeskTaskType.REVIEW_REQUEST,
          taskStatus,
          title: candidate.row.taskName ?? `${candidate.row.documentType ?? "Documento"} ${item.itemKey}`,
          assignedDesigner: candidate.row.approvedBy,
          versionsCount: candidate.row.latestVersion ? Number(candidate.row.latestVersion) || 0 : 0,
          latestVersionLabel: candidate.row.latestVersion,
          reviewDecision: reviewDecisionFor(candidate.approvalState),
          approvedVersionAvailable: candidate.approved,
          sourceUpdatedAt: approvedAt,
          sourceTaskNumber: candidate.row.taskNumber
        },
        create: {
          externalTaskId: externalId,
          projectItemId: item.id,
          taskType: MoondeskTaskType.REVIEW_REQUEST,
          taskStatus,
          title: candidate.row.taskName ?? `${candidate.row.documentType ?? "Documento"} ${item.itemKey}`,
          assignedDesigner: candidate.row.approvedBy,
          versionsCount: candidate.row.latestVersion ? Number(candidate.row.latestVersion) || 0 : 0,
          latestVersionLabel: candidate.row.latestVersion,
          reviewDecision: reviewDecisionFor(candidate.approvalState),
          approvedVersionAvailable: candidate.approved,
          sourceUpdatedAt: approvedAt,
          sourceTaskNumber: candidate.row.taskNumber
        }
      });

      const externalDocumentId = `${externalId}:doc`;
      await prisma.moondeskDocument.upsert({
        where: { externalDocumentId },
        update: {
          moondeskTaskId: task.id,
          documentType,
          name: candidate.row.description ?? candidate.row.documentType ?? "Documento Moondesk",
          approved: candidate.approved,
          versionLabel: candidate.row.latestVersion
        },
        create: {
          externalDocumentId,
          moondeskTaskId: task.id,
          documentType,
          name: candidate.row.description ?? candidate.row.documentType ?? "Documento Moondesk",
          approved: candidate.approved,
          versionLabel: candidate.row.latestVersion
        }
      });

      await projectItemEvidencesRepository.upsert({
        projectItemId: item.id,
        sourceType: "moondesk",
        sourceRecordKey: evidenceSourceRecordKey(project.code, candidate),
        matchRule: "moondesk_report_slot_match",
        matchConfidence: "MEDIUM",
        matchStatus: candidate.approved ? "EXACT" : "INFERRED",
        isPrimary: false,
        rawLabel: candidate.row.description ?? candidate.row.documentType,
        rawData: {
          sourceType: "moondesk",
          taskNumber: candidate.row.taskNumber,
          documentNumber: candidate.row.documentNumber,
          documentType: candidate.row.documentType,
          materialCode: candidate.row.materialCode,
          approvalState: candidate.approvalState,
          approved: candidate.approved,
          approvedBy: candidate.row.approvedBy,
          changeRequestedBy: candidate.row.changeRequestedBy,
          pendingWith: candidate.row.pendingWith,
          approvalDate: approvedAt ? approvedAt.toISOString() : null,
          latestVersion: candidate.row.latestVersion
        } satisfies Prisma.InputJsonObject
      });

      touchedItemIds.add(item.id);
      applied.push({
        projectItemId: item.id,
        itemKey: item.itemKey,
        componentSlot: candidate.componentSlot,
        materialCode: candidate.row.materialCode,
        approvalState: candidate.approvalState,
        approved: candidate.approved
      });
    }

    for (const itemId of touchedItemIds) {
      await projectItemsService.recalculateProjectItem(itemId);
    }

    return {
      projectCode: project.code,
      applied,
      itemsTouched: touchedItemIds.size,
      diagnostics
    };
  },

  /**
   * Enriquece las MoondeskTask ya creadas (por el reporte Tasks) con los reportes
   * de tiempos: metricas de proceso (subtareas, reprocesos, dias por fase) desde
   * Tasks_Times, y trazabilidad de revisiones desde Users_Tasks_Times.
   * Requiere que applyReport se haya corrido antes (necesita sourceTaskNumber).
   */
  async applyTimesReports(params: {
    projectCode: string;
    tasksTimesWorkbookPath?: string;
    usersTasksTimesWorkbookPath?: string;
  }) {
    const project = await prisma.project.findUnique({
      where: { code: params.projectCode },
      select: { id: true, code: true }
    });

    if (!project) {
      throw new Error(`Project not found: ${params.projectCode}`);
    }

    const tasks = await prisma.moondeskTask.findMany({
      where: { projectItem: { projectId: project.id }, sourceTaskNumber: { not: null } }
    });

    const timingByTask: Map<string, MoondeskTaskTiming> = params.tasksTimesWorkbookPath
      ? parseTasksTimes(params.tasksTimesWorkbookPath)
      : new Map();
    const stepsByTask: Map<string, MoondeskUserStep[]> = params.usersTasksTimesWorkbookPath
      ? parseUsersTasksTimes(params.usersTasksTimesWorkbookPath)
      : new Map();

    let tasksEnriched = 0;
    let reviewsUpserted = 0;

    for (const task of tasks) {
      const taskNumber = task.sourceTaskNumber;

      if (!taskNumber) {
        continue;
      }

      const timing = timingByTask.get(taskNumber);

      if (timing) {
        await prisma.moondeskTask.update({
          where: { id: task.id },
          data: {
            subtaskCount: timing.subtaskCount,
            reprocessCount: timing.reprocessCount,
            designDays: timing.designDays,
            reviewDays: timing.reviewDays,
            closeDays: timing.closeDays
          }
        });
        tasksEnriched += 1;
      }

      const steps = stepsByTask.get(taskNumber) ?? [];
      const reviewSteps = steps.filter((step) => isReviewerRole(step.role));

      for (const step of reviewSteps) {
        const sourceStepKey = `moondesk-review:${task.id}:${step.stepIndex}`;
        const decision =
          normalizeReviewStatus(step.status) === "hecho" ? ReviewDecision.APPROVED : ReviewDecision.PENDING;

        await prisma.moondeskReview.upsert({
          where: { sourceStepKey },
          update: {
            moondeskTaskId: task.id,
            reviewer: step.user,
            role: step.role,
            decision,
            startedAt: step.startedAt,
            reviewedAt: step.endedAt,
            workingDays: step.workingDays
          },
          create: {
            sourceStepKey,
            moondeskTaskId: task.id,
            reviewer: step.user,
            role: step.role,
            decision,
            startedAt: step.startedAt,
            reviewedAt: step.endedAt,
            workingDays: step.workingDays
          }
        });
        reviewsUpserted += 1;
      }
    }

    return {
      projectCode: project.code,
      tasksConsidered: tasks.length,
      tasksEnriched,
      reviewsUpserted
    };
  }
};

function normalizeReviewStatus(status: string | null) {
  return (status ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}
