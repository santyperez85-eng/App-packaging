import {
  AlertSeverity,
  AlertStatus,
  ApplicabilityStatus,
  CheckStatus,
  ComponentSlot,
  MatchingStatus,
  MoondeskTaskStatus,
  MoondeskTaskType,
  Prisma,
  ProjectItemExpectedStatus,
  ProjectItemIdentificationStatus,
  ProjectItemOriginMode,
  ProjectItemStatus
} from "@prisma/client";

import { clampScore, compact, normalizeText } from "@/lib/utils";

export type ProblemClass = "incompletitud" | "inconsistencia" | "bloqueo";
export type DimensionKey =
  | "definition"
  | "codification"
  | "pre_sap_structure"
  | "sap_formalization"
  | "internal_technical_docs"
  | "documentation_review_approval";
export type DimensionStatus = "not_applicable" | "missing" | "partial" | "ready" | "blocked" | "inconsistent";

export type ProjectItemRulesRecord = Prisma.ProjectItemGetPayload<{
  include: {
    project: true;
    bomItem: true;
    materialRequest: true;
    materialMaster: {
      include: {
        sapMaterial: true;
      };
    };
    alerts: true;
    evidences: true;
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
  metadata?: Prisma.InputJsonObject;
};

export type DimensionEvaluation = {
  key: DimensionKey;
  status: DimensionStatus;
  score: number;
  blocking: boolean;
  alerts: RuleAlertSeed[];
  signals: string[];
};

type ComponentOperationalProfile = {
  key: string;
  dimensionWeights: Record<DimensionKey, number>;
  alertPriorities: Partial<Record<string, number>>;
};

const DEFAULT_DIMENSION_WEIGHTS: Record<DimensionKey, number> = {
  definition: 0.15,
  codification: 0.2,
  pre_sap_structure: 0.15,
  sap_formalization: 0.15,
  internal_technical_docs: 0.15,
  documentation_review_approval: 0.2
};

const PRIMARY_PACKAGING_WEIGHTS: Record<DimensionKey, number> = {
  definition: 0.04,
  codification: 0.36,
  pre_sap_structure: 0.32,
  sap_formalization: 0.17,
  internal_technical_docs: 0.08,
  documentation_review_approval: 0.03
};

const PROSPECTO_WEIGHTS: Record<DimensionKey, number> = {
  definition: 0.03,
  codification: 0.08,
  pre_sap_structure: 0.3,
  sap_formalization: 0.06,
  internal_technical_docs: 0.1,
  documentation_review_approval: 0.43
};

const ESTUCHE_WEIGHTS: Record<DimensionKey, number> = {
  definition: 0.2,
  codification: 0.15,
  pre_sap_structure: 0.1,
  sap_formalization: 0.1,
  internal_technical_docs: 0.1,
  documentation_review_approval: 0.35
};

const DEFAULT_ALERT_PRIORITIES: Record<string, number> = {
  CROSS_SOURCE_INCONSISTENCY: 100,
  DEFINITION_AMBIGUOUS: 95,
  BLOCKING_CHECKS_PENDING: 95,
  PHASE_MISMATCH: 95,
  REVIEW_OVERDUE: 95,
  DESIGN_WITHOUT_REVIEW: 90,
  INTERNAL_TECH_DOCS_MISSING: 75,
  REQUEST_WITHOUT_FORMAL_MATERIAL: 70,
  CODE_NOT_REQUESTED: 60,
  PRE_BOM_MISSING: 55,
  PRE_BOM_PENDING_CONFIRMATION: 50,
  APPROVED_DOCUMENT_MISSING: 50,
  DEFINITION_MISSING: 45,
  EXPECTED_COMPONENT_MISSING: 30
};

const PENDING_CONFIRMATION_HINTS = [
  "pend",
  "pending",
  "confirm",
  "confirmacion",
  "confirmacion pendiente",
  "sin confirmar",
  "por definir"
];

function buildRuleAlert(params: {
  ruleCode: string;
  type: string;
  title: string;
  message: string;
  severity: AlertSeverity;
  problemClass: ProblemClass;
  dimension: DimensionKey;
  status: DimensionStatus;
  priority?: number;
}) {
  return {
    ruleCode: params.ruleCode,
    type: params.type,
    title: params.title,
    message: params.message,
    severity: params.severity,
    metadata: {
      problemClass: params.problemClass,
      dimension: params.dimension,
      dimensionStatus: params.status,
      ...(params.priority !== undefined ? { priority: params.priority } : {})
    } satisfies Prisma.InputJsonObject
  } satisfies RuleAlertSeed;
}

function hasEvidenceSource(item: ProjectItemRulesRecord, sourceType: string) {
  return item.evidences.some((evidence) => evidence.sourceType === sourceType);
}

export function hasSecondaryEvidence(item: ProjectItemRulesRecord) {
  return Boolean(
    item.bomItem ||
      item.materialRequest ||
      item.materialMaster ||
      item.moondeskTasks.length > 0 ||
      item.evidences.some((evidence) => evidence.sourceType !== "pm_expected")
  );
}

export function isOperationalProjectItem(item: ProjectItemRulesRecord) {
  return (
    item.applicabilityStatus !== ApplicabilityStatus.DOES_NOT_APPLY &&
    item.expectedStatus !== ProjectItemExpectedStatus.NOT_EXPECTED
  );
}

export function isExpectedProjectItem(item: ProjectItemRulesRecord) {
  return (
    item.applicabilityStatus !== ApplicabilityStatus.DOES_NOT_APPLY &&
    (item.originMode === ProjectItemOriginMode.PM_EXPECTED ||
      item.expectedStatus === ProjectItemExpectedStatus.EXPECTED ||
      item.expectedStatus === ProjectItemExpectedStatus.EXPECTED_BUT_MISSING)
  );
}

export function getComponentOperationalProfile(componentSlot: ComponentSlot): ComponentOperationalProfile {
  if (
    componentSlot === ComponentSlot.BLISTER ||
    componentSlot === ComponentSlot.ALUMINIO ||
    componentSlot === ComponentSlot.FRASCO ||
    componentSlot === ComponentSlot.POMO
  ) {
    return {
      key: "primary_packaging",
      dimensionWeights: PRIMARY_PACKAGING_WEIGHTS,
      alertPriorities: {
        CODE_NOT_REQUESTED: 85,
        PRE_BOM_MISSING: 80,
        REQUEST_WITHOUT_FORMAL_MATERIAL: 75,
        INTERNAL_TECH_DOCS_MISSING: 75,
        APPROVED_DOCUMENT_MISSING: 55,
        EXPECTED_COMPONENT_MISSING: 30
      }
    };
  }

  if (componentSlot === ComponentSlot.PROSPECTO) {
    return {
      key: "leaflet_regulatory",
      dimensionWeights: PROSPECTO_WEIGHTS,
      alertPriorities: {
        APPROVED_DOCUMENT_MISSING: 90,
        CODE_NOT_REQUESTED: 50,
        PRE_BOM_MISSING: 40,
        REQUEST_WITHOUT_FORMAL_MATERIAL: 60,
        EXPECTED_COMPONENT_MISSING: 30
      }
    };
  }

  if (componentSlot === ComponentSlot.ESTUCHE) {
    return {
      key: "secondary_packaging",
      dimensionWeights: ESTUCHE_WEIGHTS,
      alertPriorities: {
        CODE_NOT_REQUESTED: 70,
        APPROVED_DOCUMENT_MISSING: 65,
        PRE_BOM_MISSING: 60,
        REQUEST_WITHOUT_FORMAL_MATERIAL: 60,
        EXPECTED_COMPONENT_MISSING: 30
      }
    };
  }

  return {
    key: "default_packaging",
    dimensionWeights: DEFAULT_DIMENSION_WEIGHTS,
    alertPriorities: {}
  };
}

export function getDimensionWeights(item: ProjectItemRulesRecord) {
  return getComponentOperationalProfile(item.componentSlot).dimensionWeights;
}

function getAlertPriority(item: ProjectItemRulesRecord, ruleCode: string) {
  const profile = getComponentOperationalProfile(item.componentSlot);

  return profile.alertPriorities[ruleCode] ?? DEFAULT_ALERT_PRIORITIES[ruleCode] ?? 50;
}

function getApprovedDocumentMissingSeverity(item: ProjectItemRulesRecord) {
  return item.componentSlot === ComponentSlot.PROSPECTO ? AlertSeverity.CRITICAL : AlertSeverity.WARNING;
}

function getAlertPriorityValue(alert: RuleAlertSeed) {
  const priority = alert.metadata?.priority;

  if (typeof priority === "number") {
    return priority;
  }

  return DEFAULT_ALERT_PRIORITIES[alert.ruleCode] ?? 50;
}

function getGeneratedAlertPenalty(alert: RuleAlertSeed) {
  const priority = getAlertPriorityValue(alert);

  if (alert.severity === AlertSeverity.CRITICAL) {
    if (priority >= 90) return 10;
    if (priority >= 75) return 8;
    return 6;
  }

  if (alert.severity === AlertSeverity.WARNING) {
    if (priority >= 80) return 4;
    if (priority >= 70) return 3;
    if (priority >= 55) return 2;
    return 1;
  }

  return priority >= 80 ? 1 : 0;
}

function parsePhaseToken(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = normalizeText(value);
    const match = normalized.match(/(?:fase|phase)\s*([1-4])/);

    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function collectMaterialCodeSignals(item: ProjectItemRulesRecord) {
  return compact([
    item.expectedMaterialCode ? `expected:${item.expectedMaterialCode}` : null,
    item.bomItem?.expectedMaterialCode ? `bom:${item.bomItem.expectedMaterialCode}` : null,
    item.materialRequest?.linkedMaterialCode ? `request:${item.materialRequest.linkedMaterialCode}` : null,
    item.materialMaster?.materialCode ? `master:${item.materialMaster.materialCode}` : null
  ]);
}

function dimensionDefinition(item: ProjectItemRulesRecord): DimensionEvaluation {
  if (!isOperationalProjectItem(item)) {
    return {
      key: "definition",
      status: "not_applicable",
      score: 100,
      blocking: false,
      alerts: [],
      signals: []
    };
  }

  const missingDefinition = !item.name.trim() || item.componentSlot === ComponentSlot.OTRO;
  const inconsistentIdentification =
    item.matchingStatus === MatchingStatus.EXACT &&
    item.identificationStatus !== ProjectItemIdentificationStatus.IDENTIFIED;
  const alerts = compact<RuleAlertSeed>([
    item.matchingStatus === MatchingStatus.AMBIGUOUS
      ? buildRuleAlert({
          ruleCode: "DEFINITION_AMBIGUOUS",
          type: "DEFINITION_AMBIGUOUS",
          title: "Definicion ambigua",
          message: `La definicion operativa de ${item.name} es ambigua y requiere revision manual.`,
          severity: AlertSeverity.CRITICAL,
          problemClass: "inconsistencia",
          dimension: "definition",
          status: "inconsistent",
          priority: getAlertPriority(item, "DEFINITION_AMBIGUOUS")
        })
      : null,
    inconsistentIdentification
      ? buildRuleAlert({
          ruleCode: "CROSS_SOURCE_INCONSISTENCY",
          type: "CROSS_SOURCE_INCONSISTENCY",
          title: "Inconsistencia entre matching e identificacion",
          message: `El item ${item.name} figura con matching exacto, pero no quedo identificado de forma consistente.`,
          severity: AlertSeverity.CRITICAL,
          problemClass: "inconsistencia",
          dimension: "definition",
          status: "inconsistent",
          priority: getAlertPriority(item, "CROSS_SOURCE_INCONSISTENCY")
        })
      : null,
    item.matchingStatus !== MatchingStatus.AMBIGUOUS && (missingDefinition || item.matchingStatus === MatchingStatus.MANUAL_REVIEW)
      ? buildRuleAlert({
          ruleCode: "DEFINITION_MISSING",
          type: "DEFINITION_MISSING",
          title: "Definicion incompleta",
          message: `El componente ${item.name} no esta suficientemente definido para continuar el seguimiento operativo.`,
          severity: AlertSeverity.WARNING,
          problemClass: "incompletitud",
          dimension: "definition",
          status: "missing",
          priority: getAlertPriority(item, "DEFINITION_MISSING")
        })
      : null
  ]);

  if (item.matchingStatus === MatchingStatus.AMBIGUOUS || inconsistentIdentification) {
    return {
      key: "definition",
      status: "inconsistent",
      score: 20,
      blocking: true,
      alerts,
      signals: compact([
        item.matchingStatus === MatchingStatus.AMBIGUOUS ? "matching_ambiguous" : null,
        inconsistentIdentification ? "matching_identification_inconsistent" : null
      ])
    };
  }

  if (missingDefinition || item.matchingStatus === MatchingStatus.MANUAL_REVIEW) {
    return {
      key: "definition",
      status: "missing",
      score: 40,
      blocking: false,
      alerts,
      signals: ["definition_incomplete"]
    };
  }

  if (item.matchingStatus === MatchingStatus.INFERRED) {
    return {
      key: "definition",
      status: "partial",
      score: 75,
      blocking: false,
      alerts,
      signals: ["definition_inferred"]
    };
  }

  return {
    key: "definition",
    status: "ready",
    score: 100,
    blocking: false,
    alerts,
    signals: []
  };
}

function dimensionCodification(item: ProjectItemRulesRecord): DimensionEvaluation {
  if (!item.requiresMaterialCode || item.applicabilityStatus === ApplicabilityStatus.DOES_NOT_APPLY) {
    return {
      key: "codification",
      status: "not_applicable",
      score: 100,
      blocking: false,
      alerts: [],
      signals: []
    };
  }

  if (item.materialMaster) {
    return {
      key: "codification",
      status: "ready",
      score: 100,
      blocking: false,
      alerts: [],
      signals: ["material_identified"]
    };
  }

  const hasRequestSignal = Boolean(item.materialRequest || item.provisionalCode || hasEvidenceSource(item, "material_request"));

  if (hasRequestSignal) {
    return {
      key: "codification",
      status: "partial",
      score: 55,
      blocking: false,
      alerts: [],
      signals: ["code_requested"]
    };
  }

  return {
    key: "codification",
    status: "missing",
    score: 10,
    blocking: false,
    alerts: [
      buildRuleAlert({
        ruleCode: "CODE_NOT_REQUESTED",
        type: "CODE_NOT_REQUESTED",
        title: "Codigo no solicitado",
        message: `El componente ${item.name} requiere codificacion y todavia no tiene pedido de codigo.`,
        severity: AlertSeverity.WARNING,
        problemClass: "incompletitud",
        dimension: "codification",
        status: "missing",
        priority: getAlertPriority(item, "CODE_NOT_REQUESTED")
      })
    ],
    signals: ["code_not_requested"]
  };
}

function dimensionPreSapStructure(item: ProjectItemRulesRecord): DimensionEvaluation {
  if (!isOperationalProjectItem(item)) {
    return {
      key: "pre_sap_structure",
      status: "not_applicable",
      score: 100,
      blocking: false,
      alerts: [],
      signals: []
    };
  }

  const bomNotes = normalizeText(item.bomItem?.notes);
  const pendingConfirmation = PENDING_CONFIRMATION_HINTS.some((hint) => bomNotes.includes(hint));

  if (item.bomItem && !pendingConfirmation) {
    return {
      key: "pre_sap_structure",
      status: "ready",
      score: 100,
      blocking: false,
      alerts: [],
      signals: ["bom_present"]
    };
  }

  if (item.bomItem && pendingConfirmation) {
    return {
      key: "pre_sap_structure",
      status: "partial",
      score: 60,
      blocking: false,
      alerts: [
        buildRuleAlert({
          ruleCode: "PRE_BOM_PENDING_CONFIRMATION",
          type: "PRE_BOM_PENDING_CONFIRMATION",
          title: "Pre-BOM pendiente de confirmacion",
          message: `La estructura pre-SAP de ${item.name} tiene confirmaciones operativas pendientes.`,
          severity: AlertSeverity.WARNING,
          problemClass: "incompletitud",
          dimension: "pre_sap_structure",
          status: "partial",
          priority: getAlertPriority(item, "PRE_BOM_PENDING_CONFIRMATION")
        })
      ],
      signals: ["bom_pending_confirmation"]
    };
  }

  return {
    key: "pre_sap_structure",
    status: "missing",
    score: 20,
    blocking: false,
    alerts: [
      buildRuleAlert({
        ruleCode: "PRE_BOM_MISSING",
        type: "PRE_BOM_MISSING",
        title: "Pre-BOM faltante",
        message: `El componente ${item.name} todavia no tiene estructura pre-SAP registrada.`,
        severity: AlertSeverity.WARNING,
        problemClass: "incompletitud",
        dimension: "pre_sap_structure",
        status: "missing",
        priority: getAlertPriority(item, "PRE_BOM_MISSING")
      })
    ],
    signals: ["bom_missing"]
  };
}

function dimensionSapFormalization(item: ProjectItemRulesRecord): DimensionEvaluation {
  if (!item.requiresMaterialCode || item.applicabilityStatus === ApplicabilityStatus.DOES_NOT_APPLY) {
    return {
      key: "sap_formalization",
      status: "not_applicable",
      score: 100,
      blocking: false,
      alerts: [],
      signals: []
    };
  }

  const bomPhase = parsePhaseToken(item.bomItem?.notes);
  const sapPhase = parsePhaseToken(item.materialMaster?.sapMaterial?.purchaseStatus, item.materialMaster?.sapMaterial?.description);
  const phaseMismatch = Boolean(bomPhase && sapPhase && bomPhase !== sapPhase);

  if (item.materialMaster?.sapMaterial && phaseMismatch) {
    return {
      key: "sap_formalization",
      status: "inconsistent",
      score: 45,
      blocking: true,
      alerts: [
        buildRuleAlert({
          ruleCode: "PHASE_MISMATCH",
          type: "PHASE_MISMATCH",
          title: "Desalineacion de fase",
          message: `La fase operativa de ${item.name} no coincide entre pre-SAP y la informacion formal disponible.`,
          severity: AlertSeverity.CRITICAL,
          problemClass: "inconsistencia",
          dimension: "sap_formalization",
          status: "inconsistent",
          priority: getAlertPriority(item, "PHASE_MISMATCH")
        })
      ],
      signals: ["phase_mismatch"]
    };
  }

  if (item.materialMaster?.sapMaterial) {
    return {
      key: "sap_formalization",
      status: "ready",
      score: item.materialMaster.sapMaterial.activeFlag ? 100 : 85,
      blocking: false,
      alerts: [],
      signals: ["sap_material_present"]
    };
  }

  const hasFormalizationSignal = Boolean(item.materialRequest || item.provisionalCode || item.materialMaster);

  if (hasFormalizationSignal) {
    return {
      key: "sap_formalization",
      status: "partial",
      score: item.materialMaster ? 45 : 30,
      blocking: false,
      alerts: item.materialRequest || item.provisionalCode
        ? [
            buildRuleAlert({
              ruleCode: "REQUEST_WITHOUT_FORMAL_MATERIAL",
              type: "REQUEST_WITHOUT_FORMAL_MATERIAL",
              title: "Pedido sin material formal",
              message: `Existe avance de codificacion para ${item.name}, pero todavia no hay material formal en SAP.`,
              severity: AlertSeverity.WARNING,
              problemClass: "incompletitud",
              dimension: "sap_formalization",
              status: "partial",
              priority: getAlertPriority(item, "REQUEST_WITHOUT_FORMAL_MATERIAL")
            })
          ]
        : [],
      signals: ["formalization_pending"]
    };
  }

  return {
    key: "sap_formalization",
    status: "missing",
    score: 0,
    blocking: false,
    alerts: [],
    signals: ["formalization_missing"]
  };
}

function dimensionInternalTechnicalDocs(item: ProjectItemRulesRecord): DimensionEvaluation {
  if (!item.requiresTechnicalDocs) {
    return {
      key: "internal_technical_docs",
      status: "not_applicable",
      score: 100,
      blocking: false,
      alerts: [],
      signals: []
    };
  }

  if (!item.materialMaster) {
    return {
      key: "internal_technical_docs",
      status: "missing",
      score: 0,
      blocking: false,
      alerts: [],
      signals: ["material_missing_for_tech_docs"]
    };
  }

  const missingDocs = compact([
    !item.materialMaster.drawingCode ? "plano" : null,
    !item.materialMaster.specificationCode ? "especificacion" : null,
    !item.materialMaster.technicalSheetCode ? "ficha tecnica" : null
  ]);
  const availableDocs = 3 - missingDocs.length;

  if (missingDocs.length === 0) {
    return {
      key: "internal_technical_docs",
      status: "ready",
      score: 100,
      blocking: false,
      alerts: [],
      signals: ["technical_docs_complete"]
    };
  }

  return {
    key: "internal_technical_docs",
    status: "partial",
    score: availableDocs === 2 ? 75 : availableDocs === 1 ? 45 : 15,
    blocking: false,
    alerts: [
      buildRuleAlert({
        ruleCode: "INTERNAL_TECH_DOCS_MISSING",
        type: "INTERNAL_TECH_DOCS_MISSING",
        title: "Documentacion tecnica interna faltante",
        message: `El material ${item.materialMaster.materialCode} no tiene ${missingDocs.join(", ")}.`,
        severity: missingDocs.length > 1 ? AlertSeverity.CRITICAL : AlertSeverity.WARNING,
        problemClass: "incompletitud",
        dimension: "internal_technical_docs",
        status: "partial",
        priority: getAlertPriority(item, "INTERNAL_TECH_DOCS_MISSING")
      })
    ],
    signals: missingDocs
  };
}

function dimensionDocumentationApproval(item: ProjectItemRulesRecord, today: Date): DimensionEvaluation {
  if (!item.requiresApprovedDocument) {
    return {
      key: "documentation_review_approval",
      status: "not_applicable",
      score: 100,
      blocking: false,
      alerts: [],
      signals: []
    };
  }

  const designTasks = item.moondeskTasks.filter((task) => task.taskType === MoondeskTaskType.DESIGN_REQUEST);
  const reviewTasks = item.moondeskTasks.filter((task) => task.taskType === MoondeskTaskType.REVIEW_REQUEST);
  const hasApprovedDocument = item.moondeskTasks.some(
    (task) => task.approvedVersionAvailable || task.documents.some((document) => document.approved)
  );
  const designCompletedWithoutReview =
    designTasks.some((task) => task.taskStatus === MoondeskTaskStatus.COMPLETED) && reviewTasks.length === 0;
  const overdueReview = reviewTasks.some(
    (task) =>
      Boolean(task.dueDate) &&
      task.dueDate !== null &&
      task.dueDate < today &&
      task.taskStatus !== MoondeskTaskStatus.COMPLETED
  );

  if (hasApprovedDocument) {
    return {
      key: "documentation_review_approval",
      status: "ready",
      score: 100,
      blocking: false,
      alerts: [],
      signals: ["approved_document_available"]
    };
  }

  if (overdueReview) {
    return {
      key: "documentation_review_approval",
      status: "blocked",
      score: 15,
      blocking: true,
      alerts: [
        buildRuleAlert({
          ruleCode: "REVIEW_OVERDUE",
          type: "REVIEW_OVERDUE",
          title: "Revision vencida",
          message: `La revision documental de ${item.name} esta vencida y sigue abierta.`,
          severity: AlertSeverity.CRITICAL,
          problemClass: "bloqueo",
          dimension: "documentation_review_approval",
          status: "blocked",
          priority: getAlertPriority(item, "REVIEW_OVERDUE")
        })
      ],
      signals: ["review_overdue"]
    };
  }

  if (designCompletedWithoutReview) {
    return {
      key: "documentation_review_approval",
      status: "blocked",
      score: 25,
      blocking: true,
      alerts: [
        buildRuleAlert({
          ruleCode: "DESIGN_WITHOUT_REVIEW",
          type: "DESIGN_WITHOUT_REVIEW",
          title: "Diseno completado sin revision",
          message: `La tarea de diseno de ${item.name} esta completada y no existe revision asociada.`,
          severity: AlertSeverity.CRITICAL,
          problemClass: "bloqueo",
          dimension: "documentation_review_approval",
          status: "blocked",
          priority: getAlertPriority(item, "DESIGN_WITHOUT_REVIEW")
        }),
        buildRuleAlert({
          ruleCode: "APPROVED_DOCUMENT_MISSING",
          type: "APPROVED_DOCUMENT_MISSING",
          title: "Falta documento aprobado",
          message: `No existe documento aprobado para ${item.name}.`,
          severity: getApprovedDocumentMissingSeverity(item),
          problemClass: "incompletitud",
          dimension: "documentation_review_approval",
          status: "partial",
          priority: getAlertPriority(item, "APPROVED_DOCUMENT_MISSING")
        })
      ],
      signals: ["review_missing"]
    };
  }

  if (reviewTasks.length > 0) {
    return {
      key: "documentation_review_approval",
      status: "partial",
      score: 65,
      blocking: false,
      alerts: [
        buildRuleAlert({
          ruleCode: "APPROVED_DOCUMENT_MISSING",
          type: "APPROVED_DOCUMENT_MISSING",
          title: "Falta documento aprobado",
          message: `La revision documental de ${item.name} esta en curso, pero aun no existe version aprobada.`,
          severity: getApprovedDocumentMissingSeverity(item),
          problemClass: "incompletitud",
          dimension: "documentation_review_approval",
          status: "partial",
          priority: getAlertPriority(item, "APPROVED_DOCUMENT_MISSING")
        })
      ],
      signals: ["review_in_progress"]
    };
  }

  if (designTasks.length > 0) {
    return {
      key: "documentation_review_approval",
      status: "partial",
      score: 40,
      blocking: false,
      alerts: [
        buildRuleAlert({
          ruleCode: "APPROVED_DOCUMENT_MISSING",
          type: "APPROVED_DOCUMENT_MISSING",
          title: "Falta documento aprobado",
          message: `Existe actividad documental para ${item.name}, pero aun no hay documento aprobado.`,
          severity: getApprovedDocumentMissingSeverity(item),
          problemClass: "incompletitud",
          dimension: "documentation_review_approval",
          status: "partial",
          priority: getAlertPriority(item, "APPROVED_DOCUMENT_MISSING")
        })
      ],
      signals: ["design_in_progress"]
    };
  }

  return {
    key: "documentation_review_approval",
    status: "missing",
    score: 10,
    blocking: false,
    alerts: [
      buildRuleAlert({
        ruleCode: "APPROVED_DOCUMENT_MISSING",
        type: "APPROVED_DOCUMENT_MISSING",
        title: "Falta documento aprobado",
        message: `No existe documentacion aprobada para ${item.name}.`,
        severity: getApprovedDocumentMissingSeverity(item),
        problemClass: "incompletitud",
        dimension: "documentation_review_approval",
        status: "missing",
        priority: getAlertPriority(item, "APPROVED_DOCUMENT_MISSING")
      })
    ],
    signals: ["documentation_not_started"]
  };
}

function buildOverlayAlerts(item: ProjectItemRulesRecord): RuleAlertSeed[] {
  const materialCodeSignals = collectMaterialCodeSignals(item);
  const uniqueCodes = new Set(materialCodeSignals.map((signal) => signal.split(":")[1]).filter(Boolean));
  const hasCodeConflict = uniqueCodes.size > 1;
  const hasOnlyExpectedEvidence = isExpectedProjectItem(item) && !hasSecondaryEvidence(item);
  const blockingChecks = item.technicalChecks.filter(
    (check) => check.isBlocking && check.status !== CheckStatus.PASSED
  );

  return compact<RuleAlertSeed>([
    hasOnlyExpectedEvidence
      ? buildRuleAlert({
          ruleCode: "EXPECTED_COMPONENT_MISSING",
          type: "EXPECTED_COMPONENT_MISSING",
          title: "Componente esperado sin evidencia",
          message: `El componente esperado ${item.name} todavia no tiene evidencia operativa fuera de PM.`,
          severity: AlertSeverity.INFO,
          problemClass: "incompletitud",
          dimension: "definition",
          status: "missing",
          priority: getAlertPriority(item, "EXPECTED_COMPONENT_MISSING")
        })
      : null,
    hasCodeConflict
      ? buildRuleAlert({
          ruleCode: "CROSS_SOURCE_INCONSISTENCY",
          type: "CROSS_SOURCE_INCONSISTENCY",
          title: "Inconsistencia entre fuentes",
          message: `Las fuentes reconciliadas para ${item.name} no coinciden en el codigo de material (${materialCodeSignals.join(" / ")}).`,
          severity: AlertSeverity.CRITICAL,
          problemClass: "inconsistencia",
          dimension: "definition",
          status: "inconsistent",
          priority: getAlertPriority(item, "CROSS_SOURCE_INCONSISTENCY")
        })
      : null,
    blockingChecks.length
      ? buildRuleAlert({
          ruleCode: "BLOCKING_CHECKS_PENDING",
          type: "BLOCKING_CHECKS_PENDING",
          title: "Checks bloqueantes pendientes",
          message: `${blockingChecks.length} check(s) bloqueante(s) impiden liberar ${item.name}.`,
          severity: AlertSeverity.CRITICAL,
          problemClass: "bloqueo",
          dimension: "documentation_review_approval",
          status: "blocked",
          priority: getAlertPriority(item, "BLOCKING_CHECKS_PENDING")
        })
      : null
  ]);
}

function dedupeAlerts(alerts: RuleAlertSeed[]) {
  const registry = new Map<string, RuleAlertSeed>();

  for (const alert of alerts) {
    registry.set(alert.ruleCode, alert);
  }

  return Array.from(registry.values());
}

function determineProjectItemStatus(params: {
  item: ProjectItemRulesRecord;
  dimensions: DimensionEvaluation[];
  activeAlerts: RuleAlertSeed[];
  manualCriticalCount: number;
}) {
  const blockingChecks = params.item.technicalChecks.filter(
    (check) => check.isBlocking && check.status !== CheckStatus.PASSED
  );
  const hasBlockingDimension = params.dimensions.some((dimension) => dimension.blocking);
  const blockingAlerts = params.activeAlerts.filter(
    (alert) => alert.metadata?.problemClass === "bloqueo" || alert.metadata?.problemClass === "inconsistencia"
  );
  const codificationDimension = params.dimensions.find((dimension) => dimension.key === "codification");
  const docsDimension = params.dimensions.find((dimension) => dimension.key === "internal_technical_docs");
  const approvalDimension = params.dimensions.find((dimension) => dimension.key === "documentation_review_approval");

  if (hasBlockingDimension || blockingChecks.length > 0 || params.manualCriticalCount > 0 || blockingAlerts.length > 0) {
    return ProjectItemStatus.BLOCKED;
  }

  if (
    params.item.requiresMaterialCode &&
    codificationDimension &&
    codificationDimension.status !== "ready"
  ) {
    return ProjectItemStatus.WAITING_CODE;
  }

  if (
    (docsDimension && docsDimension.status !== "ready" && docsDimension.status !== "not_applicable") ||
    (approvalDimension && approvalDimension.status !== "ready" && approvalDimension.status !== "not_applicable")
  ) {
    return ProjectItemStatus.WAITING_DOCS;
  }

  if (params.dimensions.some((dimension) => dimension.status !== "ready" && dimension.status !== "not_applicable")) {
    return ProjectItemStatus.IN_PROGRESS;
  }

  return ProjectItemStatus.READY;
}

export function evaluateProjectItemRules(
  item: ProjectItemRulesRecord,
  today = new Date()
): {
  status: ProjectItemStatus;
  readinessScore: number;
  activeAlerts: RuleAlertSeed[];
  blockers: string[];
  dimensions: DimensionEvaluation[];
} {
  const dimensions = [
    dimensionDefinition(item),
    dimensionCodification(item),
    dimensionPreSapStructure(item),
    dimensionSapFormalization(item),
    dimensionInternalTechnicalDocs(item),
    dimensionDocumentationApproval(item, today)
  ];
  const dimensionAlerts = dimensions.flatMap((dimension) => dimension.alerts);
  const overlayAlerts = buildOverlayAlerts(item);
  const activeAlerts = dedupeAlerts([...dimensionAlerts, ...overlayAlerts]);

  const generatedRuleCodes = activeAlerts.map((alert) => alert.ruleCode);
  const manualCriticalCount = item.alerts.filter(
    (alert) =>
      alert.status === AlertStatus.OPEN &&
      alert.severity === AlertSeverity.CRITICAL &&
      (!alert.ruleCode || !generatedRuleCodes.includes(alert.ruleCode))
  ).length;
  const manualWarningCount = item.alerts.filter(
    (alert) =>
      alert.status === AlertStatus.OPEN &&
      alert.severity === AlertSeverity.WARNING &&
      (!alert.ruleCode || !generatedRuleCodes.includes(alert.ruleCode))
  ).length;

  const dimensionWeights = getDimensionWeights(item);
  const weightedDimensionScore = dimensions.reduce(
    (total, dimension) => total + dimension.score * dimensionWeights[dimension.key],
    0
  );
  const generatedAlertPenalty = activeAlerts.reduce(
    (total, alert) => total + getGeneratedAlertPenalty(alert),
    0
  );
  const readinessScore = clampScore(
    weightedDimensionScore - generatedAlertPenalty - manualCriticalCount * 8 - manualWarningCount * 4
  );

  const status = determineProjectItemStatus({
    item,
    dimensions,
    activeAlerts,
    manualCriticalCount
  });

  const blockers = compact([
    dimensions.some((dimension) => dimension.key === "definition" && dimension.blocking) ? "definition_blocked" : null,
    dimensions.some((dimension) => dimension.key === "documentation_review_approval" && dimension.blocking)
      ? "documentation_blocked"
      : null,
    dimensions.some((dimension) => dimension.key === "sap_formalization" && dimension.blocking) ? "sap_blocked" : null,
    item.technicalChecks.some((check) => check.isBlocking && check.status !== CheckStatus.PASSED)
      ? "blocking_checks"
      : null,
    manualCriticalCount ? "critical_alerts_open" : null
  ]);

  return {
    status,
    readinessScore,
    activeAlerts,
    blockers,
    dimensions
  };
}
