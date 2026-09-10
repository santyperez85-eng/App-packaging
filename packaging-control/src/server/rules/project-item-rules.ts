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
  // Un codigo erroneo invalida la codificacion del componente: hay que
  // corregirlo antes que cualquier otra cosa de esta dimension.
  SAP_MATERIAL_CODE_ERRONEOUS: 98,
  SAP_MATERIAL_DISCONTINUED: 96,
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
          title: "No queda claro qué componente es",
          message: `Hay más de una lectura posible para ${item.name}. Necesita que alguien decida cuál corresponde.`,
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
          title: "La vinculación no cierra",
          message: `${item.name} figura vinculado con seguridad, pero los datos con los que se vinculó no coinciden entre sí.`,
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
          title: "Falta definir el componente",
          message: `${item.name} no está lo bastante definido como para seguirlo.`,
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
        title: "Falta pedir el código",
        message: `${item.name} necesita código de material y todavía no hay alta.`,
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
          title: "La estructura espera confirmación",
          message: `${item.name} está en la receta, pero el bloque tiene datos sin confirmar.`,
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
        title: "Falta cargarlo en la receta",
        message: `${item.name} todavía no figura en la estructura de la receta.`,
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
          title: "La receta y SAP no van al mismo ritmo",
          message: `Lo que dice la receta de ${item.name} y lo que dice SAP describen momentos distintos del proyecto.`,
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

  const sapMaterial = item.materialMaster?.sapMaterial;

  // El material existe en SAP, pero existir no alcanza: un codigo dado de baja
  // por error y uno discontinuado son situaciones distintas y ninguna de las dos
  // es una formalizacion valida.
  if (sapMaterial?.deletionFlag) {
    return {
      key: "sap_formalization",
      status: "inconsistent",
      score: 20,
      blocking: true,
      alerts: [
        buildRuleAlert({
          ruleCode: "SAP_MATERIAL_CODE_ERRONEOUS",
          type: "SAP_MATERIAL_CODE_ERRONEOUS",
          title: "Código pedido por error",
          message: `El codigo asociado a ${item.name} figura en SAP con marca de borrado: se pidio por error y no debe usarse. Hay que corregir la codificacion del componente.`,
          severity: AlertSeverity.CRITICAL,
          problemClass: "inconsistencia",
          dimension: "sap_formalization",
          status: "inconsistent",
          priority: getAlertPriority(item, "SAP_MATERIAL_CODE_ERRONEOUS")
        })
      ],
      signals: ["sap_material_erroneous_code"]
    };
  }

  if (sapMaterial?.discontinued) {
    return {
      key: "sap_formalization",
      status: "inconsistent",
      score: 40,
      blocking: true,
      alerts: [
        buildRuleAlert({
          ruleCode: "SAP_MATERIAL_DISCONTINUED",
          type: "SAP_MATERIAL_DISCONTINUED",
          title: "Material discontinuado",
          message: `El material de ${item.name} figura como discontinuado en SAP (grupo 051): estuvo en uso y se dio de baja. Hay que definir el reemplazo.`,
          severity: AlertSeverity.CRITICAL,
          problemClass: "inconsistencia",
          dimension: "sap_formalization",
          status: "inconsistent",
          priority: getAlertPriority(item, "SAP_MATERIAL_DISCONTINUED")
        })
      ],
      signals: ["sap_material_discontinued"]
    };
  }

  if (sapMaterial) {
    return {
      key: "sap_formalization",
      status: "ready",
      score: sapMaterial.activeFlag ? 100 : 85,
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
              title: "El código se pidió pero no está en SAP",
              message: `Hay un alta para ${item.name}, pero el código todavía no aparece en el maestro de SAP.`,
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

function dimensionInternalTechnicalDocs(
  item: ProjectItemRulesRecord,
  published?: PublishedDocuments | null
): DimensionEvaluation {
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

  // La planilla interna de materiales no siempre registra el codigo del plano o
  // de la especificacion, pero el documento puede estar publicado igual. Cuando
  // el escaneo de DOCUMENTOS APROBADOS lo confirma, no corresponde decir que
  // falta: la carpeta es la evidencia mas directa que hay.
  const missingDocs = compact([
    !item.materialMaster.drawingCode && !published?.hasDrawing ? "el plano" : null,
    !item.materialMaster.specificationCode && !published?.hasSpecification ? "la especificación" : null,
    !item.materialMaster.technicalSheetCode ? "la ficha técnica" : null
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
        title: "Falta documentación técnica",
        message: `De ${item.materialMaster.materialCode} no tenemos ${missingDocs.join(", ")}.`,
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
          title: "Revisión vencida",
          message: `La revisión de ${item.name} pasó su plazo y sigue abierta.`,
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
          title: "Diseño terminado sin revisar",
          message: `El diseño de ${item.name} figura terminado en Moondesk y nadie lo revisó.`,
          severity: AlertSeverity.CRITICAL,
          problemClass: "bloqueo",
          dimension: "documentation_review_approval",
          status: "blocked",
          priority: getAlertPriority(item, "DESIGN_WITHOUT_REVIEW")
        }),
        buildRuleAlert({
          ruleCode: "APPROVED_DOCUMENT_MISSING",
          type: "APPROVED_DOCUMENT_MISSING",
          title: "Falta el arte aprobado",
          message: `No hay ningún documento aprobado para ${item.name}.`,
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
          title: "Falta el arte aprobado",
          message: `La revisión de ${item.name} está en curso, pero todavía no hay una versión aprobada.`,
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
          title: "Falta el arte aprobado",
          message: `Hay movimiento de diseño en ${item.name}, pero todavía ningún documento aprobado.`,
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
        title: "Falta el arte aprobado",
        message: `${item.name} no tiene documentación aprobada.`,
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
          title: "Sólo lo menciona el PM",
          message: `La planilla del PM pide ${item.name}, pero ninguna otra fuente lo menciona todavía.`,
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
          title: "Dos fuentes dan códigos distintos",
          message: `Para ${item.name} las fuentes no coinciden en el código de material: ${materialCodeSignals.join(" / ")}.`,
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
          title: "Controles pendientes",
          message: `Quedan ${blockingChecks.length} controles sin pasar que impiden liberar ${item.name}.`,
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

/**
 * Lo que las reglas necesitan saber de la carpeta DOCUMENTOS APROBADOS. Se pasa
 * como contexto y no como relacion porque la carpeta se indexa por codigo de
 * material, no por componente.
 */
export type PublishedDocuments = {
  hasSpecification: boolean;
  hasDrawing: boolean;
};

export function evaluateProjectItemRules(
  item: ProjectItemRulesRecord,
  today = new Date(),
  context?: { publishedDocuments?: PublishedDocuments | null }
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
    dimensionInternalTechnicalDocs(item, context?.publishedDocuments),
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
