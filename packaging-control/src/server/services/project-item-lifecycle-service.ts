import { AlertSeverity, AlertStatus, MatchingStatus, Prisma, ProjectItemStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type LifecycleRecord = Prisma.ProjectItemGetPayload<{
  include: {
    project: true;
    bomItem: true;
    materialRequest: true;
    materialMaster: true;
    evidences: true;
    alerts: true;
    moondeskTasks: { include: { documents: true; reviews: true } };
  };
}>;

type LifecycleEventKind =
  | "EXPECTATION_DEFINED"
  | "CODE_REQUESTED"
  | "PRE_BOM_STRUCTURE_EVIDENCED"
  | "DOCUMENTATION_EVIDENCED"
  | "ALERT_OPEN"
  | "ALERT_RESOLVED"
  | "CURRENT_STATE";

type LifecycleMilestoneStatus =
  | "ready"
  | "partial"
  | "missing"
  | "manual_review"
  | "not_required"
  | "not_integrated";

type LifecycleEvent = {
  sequence: number;
  kind: LifecycleEventKind;
  stage: string;
  title: string;
  occurredAt: string;
  operationalOrder: number;
  sourceType: string;
  sourceRecordKey: string | null;
  severity?: AlertSeverity;
  status?: string;
  metadata?: Record<string, unknown>;
};

type LifecycleMilestone = {
  key: string;
  label: string;
  status: LifecycleMilestoneStatus;
  operationalOrder: number;
  evidenceRefs: Array<{ sourceType: string; sourceRecordKey: string }>;
  alertRefs: Array<{ ruleCode: string | null; severity: AlertSeverity; status: AlertStatus }>;
  reason: string;
};

const EVIDENCE_OPERATIONAL_ORDER: Record<string, number> = {
  pm_expected: 10,
  material_request: 20,
  bom: 30,
  materials_master: 40,
  sap: 50,
  moondesk: 60
};

const MILESTONE_ORDER = {
  expectation: 10,
  code_request: 20,
  pre_sap_structure: 30,
  formal_material: 40,
  documentation_approval: 50,
  current_state: 90
} as const;

const INCONSISTENCY_RULES = new Set([
  "CROSS_SOURCE_INCONSISTENCY",
  "DEFINITION_AMBIGUOUS",
  "PHASE_MISMATCH"
]);

function isoDate(value: Date | null | undefined) {
  return (value ?? new Date(0)).toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseNotes(value: string | null | undefined) {
  if (!value) {
    return {};
  }

  try {
    return asRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

function metadataDimension(metadata: unknown) {
  const record = asRecord(metadata);
  const dimension = record.dimension;

  return typeof dimension === "string" ? dimension : null;
}

function alertOperationalOrder(alert: LifecycleRecord["alerts"][number]) {
  const dimension = metadataDimension(alert.metadata);

  if (dimension === "codification") {
    return MILESTONE_ORDER.code_request;
  }

  if (dimension === "pre_sap_structure") {
    return MILESTONE_ORDER.pre_sap_structure;
  }

  if (dimension === "documentation_review_approval" || dimension === "internal_technical_docs") {
    return MILESTONE_ORDER.documentation_approval;
  }

  if (dimension === "sap_formalization") {
    return MILESTONE_ORDER.formal_material;
  }

  return 80;
}

function alertStage(alert: LifecycleRecord["alerts"][number]) {
  return metadataDimension(alert.metadata) ?? "alert";
}

function severityRank(severity?: AlertSeverity) {
  if (severity === AlertSeverity.CRITICAL) {
    return 0;
  }

  if (severity === AlertSeverity.WARNING) {
    return 1;
  }

  return 2;
}

function evidenceRef(sourceType: string, sourceRecordKey: string) {
  return { sourceType, sourceRecordKey };
}

function hasOpenAlert(item: LifecycleRecord, ruleCode: string) {
  return item.alerts.some((alert) => alert.status === AlertStatus.OPEN && alert.ruleCode === ruleCode);
}

function alertsFor(item: LifecycleRecord, ruleCodes: string[]) {
  const ruleSet = new Set(ruleCodes);

  return item.alerts
    .filter((alert) => ruleSet.has(alert.ruleCode ?? ""))
    .map((alert) => ({
      ruleCode: alert.ruleCode,
      severity: alert.severity,
      status: alert.status
    }));
}

function evidenceFor(item: LifecycleRecord, sourceType: string) {
  return item.evidences.filter((evidence) => evidence.sourceType === sourceType);
}

function buildDocumentationApprovalMilestone(item: LifecycleRecord): LifecycleMilestone {
  const moondeskEvidence = evidenceFor(item, "moondesk");
  const hasApprovedDocument = item.moondeskTasks.some(
    (task) => task.approvedVersionAvailable || task.documents.some((document) => document.approved)
  );
  const hasMoondeskActivity = item.moondeskTasks.length > 0 || moondeskEvidence.length > 0;

  const status: LifecycleMilestoneStatus = !item.requiresApprovedDocument
    ? "not_required"
    : hasApprovedDocument
      ? "ready"
      : hasMoondeskActivity
        ? "partial"
        : hasOpenAlert(item, "APPROVED_DOCUMENT_MISSING")
          ? "missing"
          : "not_integrated";

  const reason = !item.requiresApprovedDocument
    ? "El componente no requiere documento aprobado."
    : hasApprovedDocument
      ? "Moondesk reporta documentacion aprobada para el componente."
      : hasMoondeskActivity
        ? "Hay actividad documental en Moondesk, pero todavia no hay version aprobada."
        : "No hay actividad documental de Moondesk asociada a este item.";

  return {
    key: "documentation_approval",
    label: "Documentacion y aprobacion",
    status,
    operationalOrder: MILESTONE_ORDER.documentation_approval,
    evidenceRefs: moondeskEvidence.map((evidence) => evidenceRef(evidence.sourceType, evidence.sourceRecordKey)),
    alertRefs: alertsFor(item, ["APPROVED_DOCUMENT_MISSING", "INTERNAL_TECH_DOCS_MISSING", "REVIEW_OVERDUE", "DESIGN_WITHOUT_REVIEW"]),
    reason
  };
}

function buildMilestones(item: LifecycleRecord): LifecycleMilestone[] {
  const pmEvidence = evidenceFor(item, "pm_expected");
  const requestEvidence = evidenceFor(item, "material_request");
  const bomEvidence = evidenceFor(item, "bom");
  const hasRequest = Boolean(item.materialRequest || requestEvidence.length);
  const hasBom = Boolean(item.bomItem || bomEvidence.length);
  const bomNotes = parseNotes(item.bomItem?.notes);
  const bomPendingConfirmation = bomNotes.pendingConfirmation === true || hasOpenAlert(item, "PRE_BOM_PENDING_CONFIRMATION");
  const preBomMissing = hasOpenAlert(item, "PRE_BOM_MISSING");

  return [
    {
      key: "expectation",
      label: "Expectativa PM",
      status: pmEvidence.length || item.originMode === "PM_EXPECTED" ? "ready" : "missing",
      operationalOrder: MILESTONE_ORDER.expectation,
      evidenceRefs: pmEvidence.map((evidence) => evidenceRef(evidence.sourceType, evidence.sourceRecordKey)),
      alertRefs: alertsFor(item, ["EXPECTED_COMPONENT_MISSING"]),
      reason: pmEvidence.length ? "El componente existe como expectativa PM trazada." : "No hay evidencia PM persistida."
    },
    {
      key: "code_request",
      label: "Pedido de codigo",
      status: item.requiresMaterialCode ? (hasRequest ? "partial" : "missing") : "not_required",
      operationalOrder: MILESTONE_ORDER.code_request,
      evidenceRefs: requestEvidence.map((evidence) => evidenceRef(evidence.sourceType, evidence.sourceRecordKey)),
      alertRefs: alertsFor(item, ["CODE_NOT_REQUESTED", "REQUEST_WITHOUT_FORMAL_MATERIAL"]),
      reason: hasRequest
        ? "Existe evidencia operativa temprana de alta/pedido de codigo."
        : item.requiresMaterialCode
          ? "El componente requiere codigo y no hay material_request asociado."
          : "El componente no requiere codigo."
    },
    {
      key: "pre_sap_structure",
      label: "Estructura pre-SAP",
      status: hasBom ? (bomPendingConfirmation ? "partial" : "ready") : preBomMissing ? "missing" : "manual_review",
      operationalOrder: MILESTONE_ORDER.pre_sap_structure,
      evidenceRefs: bomEvidence.map((evidence) => evidenceRef(evidence.sourceType, evidence.sourceRecordKey)),
      alertRefs: alertsFor(item, ["PRE_BOM_MISSING", "PRE_BOM_PENDING_CONFIRMATION"]),
      reason: hasBom
        ? bomPendingConfirmation
          ? "Hay evidencia BOM, pero el bloque conserva confirmaciones pendientes."
          : "Hay evidencia BOM confiable para el componente."
        : "No hay evidencia BOM persistida para este item."
    },
    {
      key: "formal_material",
      label: "Material formal / maestro",
      status: item.materialMaster ? "ready" : "not_integrated",
      operationalOrder: MILESTONE_ORDER.formal_material,
      evidenceRefs: evidenceFor(item, "materials_master").map((evidence) =>
        evidenceRef(evidence.sourceType, evidence.sourceRecordKey)
      ),
      alertRefs: alertsFor(item, ["REQUEST_WITHOUT_FORMAL_MATERIAL"]),
      reason: item.materialMaster
        ? "Existe material master asociado."
        : "MaterialsMaster real queda fuera del alcance de esta fase."
    },
    buildDocumentationApprovalMilestone(item)
  ];
}

function effectiveMatchStatus(evidence: LifecycleRecord["evidences"][number]) {
  return evidence.manualMatchStatus ?? evidence.matchStatus;
}

function mapEvidence(evidence: LifecycleRecord["evidences"][number]) {
  return {
    id: evidence.id,
    sourceType: evidence.sourceType,
    sourceRecordKey: evidence.sourceRecordKey,
    rawLabel: evidence.rawLabel,
    matchRule: evidence.matchRule,
    matchConfidence: evidence.matchConfidence,
    matchStatus: effectiveMatchStatus(evidence),
    computedMatchStatus: evidence.matchStatus,
    manualMatchStatus: evidence.manualMatchStatus,
    manualNote: evidence.manualNote,
    manualDecidedAt: evidence.manualDecidedAt?.toISOString() ?? null,
    lastSeenAt: evidence.lastSeenAt?.toISOString() ?? null,
    createdAt: evidence.createdAt.toISOString()
  };
}

function buildEvidenceGroups(item: LifecycleRecord) {
  return {
    primary: item.evidences
      .filter((evidence) => evidence.isPrimary || evidence.sourceType === "pm_expected")
      .map(mapEvidence),
    secondary: item.evidences
      .filter((evidence) => !evidence.isPrimary && evidence.sourceType !== "pm_expected")
      .map(mapEvidence)
  };
}

function buildEvents(item: LifecycleRecord): LifecycleEvent[] {
  const evidenceEvents: LifecycleEvent[] = item.evidences.map((evidence) => {
    const operationalOrder = EVIDENCE_OPERATIONAL_ORDER[evidence.sourceType] ?? 70;
    const kind: LifecycleEventKind =
      evidence.sourceType === "pm_expected"
        ? "EXPECTATION_DEFINED"
        : evidence.sourceType === "material_request"
          ? "CODE_REQUESTED"
          : evidence.sourceType === "bom"
            ? "PRE_BOM_STRUCTURE_EVIDENCED"
            : evidence.sourceType === "moondesk"
              ? "DOCUMENTATION_EVIDENCED"
              : "CURRENT_STATE";

    return {
      sequence: 0,
      kind,
      stage: evidence.sourceType,
      title: evidence.rawLabel ?? `${evidence.sourceType}:${evidence.sourceRecordKey}`,
      occurredAt: isoDate(evidence.lastSeenAt ?? evidence.createdAt),
      operationalOrder,
      sourceType: evidence.sourceType,
      sourceRecordKey: evidence.sourceRecordKey,
      status: evidence.matchStatus,
      metadata: {
        matchRule: evidence.matchRule,
        matchConfidence: evidence.matchConfidence,
        isPrimary: evidence.isPrimary
      }
    } satisfies LifecycleEvent;
  });

  const alertEvents = item.alerts.map((alert) => ({
    sequence: 0,
    kind: alert.status === AlertStatus.RESOLVED ? "ALERT_RESOLVED" : "ALERT_OPEN",
    stage: alertStage(alert),
    title: alert.title,
    occurredAt: isoDate(alert.resolvedAt ?? alert.createdAt),
    operationalOrder: alertOperationalOrder(alert),
    sourceType: "alert",
    sourceRecordKey: alert.ruleCode,
    severity: alert.severity,
    status: alert.status,
    metadata: {
      ruleCode: alert.ruleCode,
      type: alert.type,
      message: alert.message,
      ...asRecord(alert.metadata)
    }
  })) satisfies LifecycleEvent[];

  const currentStateEvent: LifecycleEvent = {
    sequence: 0,
    kind: "CURRENT_STATE",
    stage: "current_state",
    title: `Estado actual: ${item.status}`,
    occurredAt: isoDate(item.updatedAt),
    operationalOrder: MILESTONE_ORDER.current_state,
    sourceType: "project_item",
    sourceRecordKey: item.itemKey,
    status: item.status,
    metadata: {
      readinessScore: item.readinessScore,
      expectedStatus: item.expectedStatus,
      identificationStatus: item.identificationStatus,
      matchingStatus: item.matchingStatus
    }
  } satisfies LifecycleEvent;

  return [...evidenceEvents, ...alertEvents, currentStateEvent]
    .sort((left, right) => {
      if (left.operationalOrder !== right.operationalOrder) {
        return left.operationalOrder - right.operationalOrder;
      }

      const timeDelta = Date.parse(left.occurredAt) - Date.parse(right.occurredAt);

      if (timeDelta !== 0) {
        return timeDelta;
      }

      return severityRank(left.severity) - severityRank(right.severity);
    })
    .map((event, index) => ({
      ...event,
      sequence: index + 1
    }));
}

function buildInconsistencies(item: LifecycleRecord) {
  const evidenceReview = item.evidences
    .filter((evidence) => {
      const status = effectiveMatchStatus(evidence);

      return status === MatchingStatus.AMBIGUOUS || status === MatchingStatus.MANUAL_REVIEW;
    })
    .map((evidence) => ({
      key: "evidence_match_requires_review",
      severity: "WARNING",
      sourceType: evidence.sourceType,
      sourceRecordKey: evidence.sourceRecordKey,
      message: `La evidencia ${evidence.sourceType}:${evidence.sourceRecordKey} requiere revision de matching.`
    }));
  const ruleInconsistencies = item.alerts
    .filter((alert) => alert.status === AlertStatus.OPEN && INCONSISTENCY_RULES.has(alert.ruleCode ?? ""))
    .map((alert) => ({
      key: alert.ruleCode ?? alert.type,
      severity: alert.severity,
      sourceType: "alert",
      sourceRecordKey: alert.ruleCode,
      message: alert.message
    }));
  const operationalGaps = [
    hasOpenAlert(item, "EXPECTED_COMPONENT_MISSING")
      ? {
          key: "expected_without_operational_evidence",
          severity: AlertSeverity.INFO,
          sourceType: "alert",
          sourceRecordKey: "EXPECTED_COMPONENT_MISSING",
          message: "El item nacio desde PM, pero todavia no tiene evidencia operativa suficiente."
        }
      : null,
    hasOpenAlert(item, "PRE_BOM_MISSING")
      ? {
          key: "pre_bom_missing",
          severity: AlertSeverity.WARNING,
          sourceType: "alert",
          sourceRecordKey: "PRE_BOM_MISSING",
          message: "No hay estructura pre-SAP confiable asociada al item."
        }
      : null,
    hasOpenAlert(item, "PRE_BOM_PENDING_CONFIRMATION")
      ? {
          key: "pre_bom_pending_confirmation",
          severity: AlertSeverity.WARNING,
          sourceType: "alert",
          sourceRecordKey: "PRE_BOM_PENDING_CONFIRMATION",
          message: "Existe BOM/pre-SAP, pero conserva confirmaciones operativas pendientes."
        }
      : null,
    hasOpenAlert(item, "CODE_NOT_REQUESTED")
      ? {
          key: "code_not_requested",
          severity: AlertSeverity.WARNING,
          sourceType: "alert",
          sourceRecordKey: "CODE_NOT_REQUESTED",
          message: "El item requiere codigo y no tiene pedido de codigo valido."
        }
      : null,
    hasOpenAlert(item, "REQUEST_WITHOUT_FORMAL_MATERIAL")
      ? {
          key: "request_without_formal_material",
          severity: AlertSeverity.WARNING,
          sourceType: "alert",
          sourceRecordKey: "REQUEST_WITHOUT_FORMAL_MATERIAL",
          message: "Hay pedido de codigo, pero no existe material formal asociado."
        }
      : null
  ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  return [...ruleInconsistencies, ...evidenceReview, ...operationalGaps];
}

function buildReconstructionGaps(item: LifecycleRecord) {
  if (item.bomItem || item.evidences.some((evidence) => evidence.sourceType === "bom")) {
    return [];
  }

  if (!hasOpenAlert(item, "PRE_BOM_MISSING")) {
    return [];
  }

  return [
    {
      key: "bom_candidate_diagnostics_not_persisted",
      message:
        "No hay evidencia BOM persistida para este item. Si el adapter detecto candidatos ignorados/manual review, esos diagnostics no son reconstruibles desde project_item sin persistirlos como evidencia.",
      consequence: "El lifecycle solo puede mostrar PRE_BOM_MISSING y ausencia de BOM, no el detalle de bloques candidatos."
    }
  ];
}

function buildDerivedState(item: LifecycleRecord, milestones: LifecycleMilestone[]) {
  const blockingAlerts = item.alerts.filter((alert) => alert.status === AlertStatus.OPEN && alert.severity === AlertSeverity.CRITICAL);
  const missingMilestones = milestones.filter((milestone) => milestone.status === "missing");
  const partialMilestones = milestones.filter((milestone) => milestone.status === "partial" || milestone.status === "manual_review");

  return {
    lifecycleDefinition:
      "Lectura server-side del estado operativo de un project_item a partir de expectativa PM, evidencias operativas, alertas, readiness y status.",
    currentStatus: item.status,
    readinessScore: item.readinessScore,
    healthContribution:
      item.status === ProjectItemStatus.READY
        ? "ready"
        : blockingAlerts.length
          ? "blocked"
          : missingMilestones.length
            ? "incomplete"
            : partialMilestones.length
              ? "partial"
              : "in_progress",
    missingMilestones: missingMilestones.map((milestone) => milestone.key),
    partialMilestones: partialMilestones.map((milestone) => milestone.key),
    openCriticalAlerts: blockingAlerts.length,
    openWarningAlerts: item.alerts.filter((alert) => alert.status === AlertStatus.OPEN && alert.severity === AlertSeverity.WARNING).length
  };
}

function buildLifecycleReadModel(item: LifecycleRecord) {
  const milestones = buildMilestones(item);

  return {
    generatedAt: new Date().toISOString(),
    project: {
      id: item.project.id,
      code: item.project.code,
      name: item.project.name,
      status: item.project.status,
      healthScore: item.project.healthScore
    },
    item: {
      id: item.id,
      itemKey: item.itemKey,
      name: item.name,
      componentSlot: item.componentSlot,
      originMode: item.originMode,
      expectedStatus: item.expectedStatus,
      identificationStatus: item.identificationStatus,
      matchingStatus: item.matchingStatus,
      status: item.status,
      readinessScore: item.readinessScore,
      provisionalCode: item.provisionalCode,
      expectedMaterialCode: item.expectedMaterialCode,
      requiresMaterialCode: item.requiresMaterialCode,
      requiresTechnicalDocs: item.requiresTechnicalDocs,
      requiresApprovedDocument: item.requiresApprovedDocument
    },
    derivedState: buildDerivedState(item, milestones),
    milestones,
    evidences: buildEvidenceGroups(item),
    timeline: buildEvents(item),
    alerts: item.alerts
      .sort((left, right) => severityRank(left.severity) - severityRank(right.severity))
      .map((alert) => ({
        id: alert.id,
        ruleCode: alert.ruleCode,
        type: alert.type,
        title: alert.title,
        message: alert.message,
        severity: alert.severity,
        status: alert.status,
        dimension: metadataDimension(alert.metadata),
        metadata: asRecord(alert.metadata),
        createdAt: alert.createdAt.toISOString(),
        resolvedAt: alert.resolvedAt?.toISOString() ?? null
      })),
    inconsistencies: buildInconsistencies(item),
    reconstructionGaps: buildReconstructionGaps(item),
    documentation: buildDocumentationDetail(item)
  };
}

function buildDocumentationDetail(item: LifecycleRecord) {
  const tasks = item.moondeskTasks;

  if (!tasks.length) {
    return null;
  }

  const reviews = tasks
    .flatMap((task) => task.reviews)
    .sort((left, right) => {
      const leftTime = left.startedAt?.getTime() ?? left.createdAt.getTime();
      const rightTime = right.startedAt?.getTime() ?? right.createdAt.getTime();

      return leftTime - rightTime;
    })
    .map((review) => ({
      reviewer: review.reviewer,
      role: review.role,
      decision: review.decision,
      workingDays: review.workingDays,
      startedAt: review.startedAt?.toISOString() ?? null,
      reviewedAt: review.reviewedAt?.toISOString() ?? null
    }));

  const sumMetric = (pick: (task: LifecycleRecord["moondeskTasks"][number]) => number | null) => {
    const values = tasks.map(pick).filter((value): value is number => typeof value === "number");

    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  };

  return {
    tasks: tasks.map((task) => ({
      title: task.title,
      taskStatus: task.taskStatus,
      sourceTaskNumber: task.sourceTaskNumber,
      approvedVersionAvailable: task.approvedVersionAvailable,
      latestVersionLabel: task.latestVersionLabel,
      reprocessCount: task.reprocessCount,
      subtaskCount: task.subtaskCount,
      designDays: task.designDays,
      reviewDays: task.reviewDays,
      closeDays: task.closeDays,
      documents: task.documents.map((document) => ({
        name: document.name,
        documentType: document.documentType,
        approved: document.approved,
        versionLabel: document.versionLabel
      }))
    })),
    reviews,
    metrics: {
      reprocessCount: sumMetric((task) => task.reprocessCount),
      subtaskCount: sumMetric((task) => task.subtaskCount),
      designDays: sumMetric((task) => task.designDays),
      reviewDays: sumMetric((task) => task.reviewDays),
      closeDays: sumMetric((task) => task.closeDays),
      reviewCount: reviews.length
    }
  };
}

export const projectItemLifecycleService = {
  async getProjectItemLifecycle(projectItemId: string) {
    const item = await prisma.projectItem.findUnique({
      where: { id: projectItemId },
      include: {
        project: true,
        bomItem: true,
        materialRequest: true,
        materialMaster: true,
        evidences: {
          orderBy: [{ sourceType: "asc" }, { sourceRecordKey: "asc" }]
        },
        alerts: {
          orderBy: [{ status: "asc" }, { severity: "desc" }, { ruleCode: "asc" }]
        },
        moondeskTasks: {
          include: { documents: true, reviews: { orderBy: [{ startedAt: "asc" }] } }
        }
      }
    });

    if (!item) {
      throw new Error("Project item not found");
    }

    return buildLifecycleReadModel(item);
  }
};
