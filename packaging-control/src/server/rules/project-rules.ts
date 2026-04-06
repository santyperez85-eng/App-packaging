import {
  AlertSeverity,
  AlertStatus,
  MatchingStatus,
  Prisma,
  ProjectItemStatus,
  ScopeDefinedStatus
} from "@prisma/client";

import { clampScore } from "@/lib/utils";
import { hasSecondaryEvidence, isExpectedProjectItem, type ProblemClass } from "@/server/rules/project-item-rules";

export type ProjectHealthRecord = Prisma.ProjectGetPayload<{
  include: {
    projectItems: {
      include: {
        project: true;
        materialMaster: {
          include: {
            sapMaterial: true;
          };
        };
        bomItem: true;
        materialRequest: true;
        alerts: true;
        evidences: true;
        moondeskTasks: {
          include: {
            documents: true;
            reviews: true;
          };
        };
        technicalChecks: true;
      };
    };
    alerts: true;
  };
}>;

function readProblemClass(metadata: Prisma.JsonValue | null | undefined): ProblemClass | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const candidate = (metadata as Record<string, unknown>).problemClass;

  return candidate === "incompletitud" || candidate === "inconsistencia" || candidate === "bloqueo"
    ? candidate
    : null;
}

function evaluateExpectedCoverage(project: ProjectHealthRecord) {
  const expectedItems = project.projectItems.filter((item) => isExpectedProjectItem(item));

  if (expectedItems.length === 0) {
    if (project.scopeDefined === ScopeDefinedStatus.DEFINED) {
      return 25;
    }

    if (project.scopeDefined === ScopeDefinedStatus.PARTIAL) {
      return 60;
    }

    return 100;
  }

  const coveredItems = expectedItems.filter((item) => hasSecondaryEvidence(item)).length;

  return clampScore((coveredItems / expectedItems.length) * 100);
}

export type ProjectHealthBreakdown = {
  averageReadiness: number;
  coverageScore: number;
  blockerScore: number;
  alignmentScore: number;
  blockedItems: number;
  waitingCodeItems: number;
  waitingDocsItems: number;
  inProgressItems: number;
  criticalIncompleteItems: number;
  blockingAlerts: number;
  inconsistencyAlerts: number;
  openCriticalAlerts: number;
  ambiguousItems: number;
  manualReviewItems: number;
  expectedItems: number;
  coveredExpectedItems: number;
  expectedButUncoveredItems: number;
  openAlerts: number;
  healthScore: number;
};

export function evaluateProjectHealthBreakdown(project: ProjectHealthRecord): ProjectHealthBreakdown {
  const averageReadiness =
    project.projectItems.length === 0
      ? 0
      : project.projectItems.reduce((total, item) => total + item.readinessScore, 0) / project.projectItems.length;
  const coverageScore = evaluateExpectedCoverage(project);
  const blockedItems = project.projectItems.filter((item) => item.status === ProjectItemStatus.BLOCKED).length;
  const waitingCodeItems = project.projectItems.filter((item) => item.status === ProjectItemStatus.WAITING_CODE).length;
  const waitingDocsItems = project.projectItems.filter((item) => item.status === ProjectItemStatus.WAITING_DOCS).length;
  const inProgressItems = project.projectItems.filter((item) => item.status === ProjectItemStatus.IN_PROGRESS).length;
  const criticalIncompleteItems = project.projectItems.filter(
    (item) => item.criticality === "CRITICAL" && item.status !== ProjectItemStatus.READY
  ).length;
  const openAlerts = project.alerts.filter((alert) => alert.status === AlertStatus.OPEN);
  const blockingAlerts = openAlerts.filter((alert) => readProblemClass(alert.metadata) === "bloqueo").length;
  const inconsistencyAlerts = openAlerts.filter((alert) => readProblemClass(alert.metadata) === "inconsistencia").length;
  const openCriticalAlerts = openAlerts.filter((alert) => alert.severity === AlertSeverity.CRITICAL).length;
  const ambiguousItems = project.projectItems.filter((item) => item.matchingStatus === MatchingStatus.AMBIGUOUS).length;
  const manualReviewItems = project.projectItems.filter((item) => item.matchingStatus === MatchingStatus.MANUAL_REVIEW).length;
  const expectedButUncoveredItems = project.projectItems.filter(
    (item) => isExpectedProjectItem(item) && !hasSecondaryEvidence(item)
  ).length;
  const expectedItems = project.projectItems.filter((item) => isExpectedProjectItem(item)).length;
  const coveredExpectedItems = expectedItems - expectedButUncoveredItems;

  const blockerScore = clampScore(
    100 -
      blockedItems * 18 -
      waitingCodeItems * 12 -
      waitingDocsItems * 10 -
      inProgressItems * 4 -
      criticalIncompleteItems * 12 -
      blockingAlerts * 8 -
      openCriticalAlerts * 4
  );
  const alignmentScore = clampScore(100 - inconsistencyAlerts * 18 - ambiguousItems * 12 - manualReviewItems * 6);

  const healthScore = clampScore(
    Math.round(
      averageReadiness * 0.45 +
        coverageScore * 0.2 +
        blockerScore * 0.2 +
        alignmentScore * 0.15 -
        expectedButUncoveredItems * 10 -
        waitingCodeItems * 6 -
        waitingDocsItems * 5 -
        blockedItems * 8
    )
  );

  return {
    averageReadiness,
    coverageScore,
    blockerScore,
    alignmentScore,
    blockedItems,
    waitingCodeItems,
    waitingDocsItems,
    inProgressItems,
    criticalIncompleteItems,
    blockingAlerts,
    inconsistencyAlerts,
    openCriticalAlerts,
    ambiguousItems,
    manualReviewItems,
    expectedItems,
    coveredExpectedItems,
    expectedButUncoveredItems,
    openAlerts: openAlerts.length,
    healthScore
  };
}

export function evaluateProjectHealth(project: ProjectHealthRecord) {
  return evaluateProjectHealthBreakdown(project).healthScore;
}

export function canCloseProject(project: ProjectHealthRecord) {
  return !project.projectItems.some(
    (item) =>
      (isExpectedProjectItem(item) && !hasSecondaryEvidence(item)) ||
      item.status === ProjectItemStatus.WAITING_CODE ||
      item.status === ProjectItemStatus.WAITING_DOCS ||
      item.status === ProjectItemStatus.BLOCKED
  );
}
