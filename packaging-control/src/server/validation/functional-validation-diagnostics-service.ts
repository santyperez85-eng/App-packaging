import {
  AlertStatus,
  ApplicabilityStatus,
  MatchingStatus,
  ProjectItemExpectedStatus,
  ProjectItemOriginMode,
  ProjectItemStatus
} from "@prisma/client";

import {
  evaluateProjectItemRules,
  hasSecondaryEvidence,
  isExpectedProjectItem,
  type DimensionEvaluation,
  type ProblemClass,
  type ProjectItemRulesRecord,
  type RuleAlertSeed
} from "@/server/rules/project-item-rules";
import {
  canCloseProject,
  evaluateProjectHealthBreakdown,
  type ProjectHealthBreakdown,
  type ProjectHealthRecord
} from "@/server/rules/project-rules";
import {
  functionalValidationScenarios,
  type FunctionalScenario,
  type FunctionalScenarioItemExpectation
} from "@/server/validation/functional-validation-fixtures";

const EVALUATION_DATE = new Date("2026-04-10T00:00:00.000Z");

const SOURCE_CATALOG = [
  { key: "pm_expected", label: "PM / ficha" },
  { key: "material_request", label: "Gestión de altas" },
  { key: "bom", label: "Pre-SAP / pre-BOM" },
  { key: "materials_master", label: "Base interna de materiales" },
  { key: "sap_material", label: "SAP" },
  { key: "moondesk", label: "Moondesk" }
] as const;

const DIMENSION_LABELS: Record<DimensionEvaluation["key"], string> = {
  definition: "Definición",
  codification: "Codificación",
  pre_sap_structure: "Estructura pre-SAP",
  sap_formalization: "Formalización SAP",
  internal_technical_docs: "Documentación técnica interna",
  documentation_review_approval: "Documentación / revisión / aprobación"
};

type EvaluatedItemRecord = ProjectItemRulesRecord;
type ProjectItemEvaluation = ReturnType<typeof evaluateProjectItemRules>;

export type FunctionalValidationAlertDiagnostic = {
  ruleCode: string;
  type: string;
  title: string;
  message: string;
  severity: string;
  problemClass: ProblemClass | null;
  dimension: string | null;
  dimensionStatus: string | null;
};

export type FunctionalValidationEvidenceDiagnostic = {
  id: string;
  sourceType: string;
  sourceLabel: string;
  sourceRecordKey: string;
  rawLabel: string | null;
  matchRule: string | null;
  matchConfidence: string | null;
  matchStatus: string;
  isPrimary: boolean;
  lastSeenAt: Date | null;
};

export type FunctionalValidationDimensionDiagnostic = {
  key: DimensionEvaluation["key"];
  label: string;
  status: DimensionEvaluation["status"];
  score: number;
  blocking: boolean;
  reason: string;
  signals: string[];
  alerts: FunctionalValidationAlertDiagnostic[];
};

export type FunctionalValidationItemDiagnostic = {
  id: string;
  itemKey: string;
  name: string;
  status: string;
  readinessScore: number;
  originMode: string;
  componentSlot: string;
  expectedStatus: string;
  identificationStatus: string;
  matchingStatus: string;
  evidences: FunctionalValidationEvidenceDiagnostic[];
  availableEvidenceSources: string[];
  missingEvidenceSources: string[];
  alerts: FunctionalValidationAlertDiagnostic[];
  blockers: string[];
  dimensions: FunctionalValidationDimensionDiagnostic[];
  why: {
    expectation: {
      summary: string;
      bullets: string[];
    };
    matching: {
      summary: string;
      bullets: string[];
    };
    evidences: {
      summary: string;
      available: string[];
      missing: string[];
    };
    decision: {
      summary: string;
      blockers: string[];
    };
  };
};

export type FunctionalValidationProjectDiagnostic = {
  id: string;
  code: string;
  name: string;
  caseType: string | null;
  scopeDefined: string;
  healthScore: number;
  canClose: boolean;
  itemCount: number;
  expectedItemCount: number;
  evidencedItemCount: number;
  blockedItemCount: number;
  openAlertCount: number;
  healthBreakdown: ProjectHealthBreakdown;
  healthSummary: string;
};

export type FunctionalValidationScenarioDiagnostic = {
  id: string;
  title: string;
  summary: string;
  passed: boolean;
  details: string[];
  project: FunctionalValidationProjectDiagnostic;
  items: FunctionalValidationItemDiagnostic[];
};

export type FunctionalValidationDiagnosticsReport = {
  generatedAt: Date;
  evaluationDate: Date;
  totalScenarios: number;
  passedScenarios: number;
  failedScenarios: number;
  scenarios: FunctionalValidationScenarioDiagnostic[];
};

function inRange(value: number, range: [number, number]) {
  return value >= range[0] && value <= range[1];
}

function formatEnumLabel(value: string | null | undefined) {
  if (!value) {
    return "sin dato";
  }

  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function lowerFirst(value: string) {
  return value.length > 1 ? `${value.slice(0, 1).toLowerCase()}${value.slice(1)}` : value.toLowerCase();
}

function joinLabels(values: string[]) {
  if (values.length === 0) {
    return "sin evidencia";
  }

  if (values.length === 1) {
    return values[0];
  }

  if (values.length === 2) {
    return `${values[0]} y ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")} y ${values[values.length - 1]}`;
}

function readMetadataValue(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const value = (metadata as Record<string, unknown>)[key];

  return typeof value === "string" ? value : null;
}

function readProblemClassFromAlert(alert: { metadata?: unknown }): ProblemClass | null {
  const candidate = readMetadataValue(alert.metadata, "problemClass");

  return candidate === "incompletitud" || candidate === "inconsistencia" || candidate === "bloqueo"
    ? candidate
    : null;
}

function sourceLabelForKey(sourceType: string | null | undefined) {
  if (!sourceType) {
    return "Fuente no identificada";
  }

  const normalized = normalizeSourceKey(sourceType);
  const catalogEntry = SOURCE_CATALOG.find((entry) => entry.key === normalized);

  return catalogEntry?.label ?? formatEnumLabel(sourceType);
}

function normalizeSourceKey(sourceType: string) {
  const normalized = sourceType.toLowerCase();

  if (normalized.includes("pm")) {
    return "pm_expected";
  }

  if (normalized.includes("request")) {
    return "material_request";
  }

  if (normalized.includes("bom")) {
    return "bom";
  }

  if (normalized.includes("master")) {
    return "materials_master";
  }

  if (normalized.includes("sap")) {
    return "sap_material";
  }

  if (normalized.includes("moondesk")) {
    return "moondesk";
  }

  return normalized;
}

function buildAlertRecord(projectId: string, itemId: string, alert: RuleAlertSeed) {
  return {
    id: `${itemId}-${alert.ruleCode}`,
    projectId,
    projectItemId: itemId,
    type: alert.type,
    title: alert.title,
    message: alert.message,
    severity: alert.severity,
    status: AlertStatus.OPEN,
    ruleCode: alert.ruleCode,
    dueDate: null,
    metadata: alert.metadata ?? null,
    resolvedAt: null,
    createdAt: EVALUATION_DATE,
    updatedAt: EVALUATION_DATE,
    project: null,
    projectItem: null
  };
}

function buildProjectForEvaluation(scenario: FunctionalScenario) {
  const evaluatedItems = scenario.project.projectItems.map((item) => {
    const evaluation = evaluateProjectItemRules(item, EVALUATION_DATE);
    const evaluatedItem = {
      ...item,
      status: evaluation.status,
      readinessScore: evaluation.readinessScore,
      alerts: evaluation.activeAlerts.map((alert) => buildAlertRecord(scenario.project.id, item.id, alert))
    } as EvaluatedItemRecord;

    return {
      item: evaluatedItem,
      evaluation
    };
  });

  const projectAlerts = evaluatedItems.flatMap((entry) => entry.item.alerts);
  const projectForEvaluation = {
    ...scenario.project,
    projectItems: evaluatedItems.map((entry) => entry.item),
    alerts: projectAlerts
  } as ProjectHealthRecord;

  return {
    evaluatedItems,
    projectForEvaluation
  };
}

function collectEvidenceSourceKeys(item: EvaluatedItemRecord) {
  const keys = new Set<string>();

  if (item.originMode === ProjectItemOriginMode.PM_EXPECTED || item.evidences.some((evidence) => normalizeSourceKey(evidence.sourceType) === "pm_expected")) {
    keys.add("pm_expected");
  }

  if (item.materialRequest || item.evidences.some((evidence) => normalizeSourceKey(evidence.sourceType) === "material_request")) {
    keys.add("material_request");
  }

  if (item.bomItem || item.evidences.some((evidence) => normalizeSourceKey(evidence.sourceType) === "bom")) {
    keys.add("bom");
  }

  if (item.materialMaster || item.evidences.some((evidence) => normalizeSourceKey(evidence.sourceType) === "materials_master")) {
    keys.add("materials_master");
  }

  if (item.materialMaster?.sapMaterial || item.evidences.some((evidence) => normalizeSourceKey(evidence.sourceType) === "sap_material")) {
    keys.add("sap_material");
  }

  if (item.moondeskTasks.length > 0 || item.evidences.some((evidence) => normalizeSourceKey(evidence.sourceType) === "moondesk")) {
    keys.add("moondesk");
  }

  return keys;
}

function buildExpectationLayer(item: EvaluatedItemRecord) {
  const bornFromPm = item.originMode === ProjectItemOriginMode.PM_EXPECTED;
  const applies =
    item.applicabilityStatus === ApplicabilityStatus.APPLIES
      ? "sí"
      : item.applicabilityStatus === ApplicabilityStatus.DOES_NOT_APPLY
        ? "no"
        : "sin definir";
  const expected =
    item.expectedStatus === ProjectItemExpectedStatus.NOT_EXPECTED ? "no esperado" : formatEnumLabel(item.expectedStatus);
  const summary = bornFromPm
    ? item.expectedStatus === ProjectItemExpectedStatus.EVIDENCED
      ? "Nació desde PM y ya quedó reconciliado con evidencia secundaria sobre el mismo item."
      : "Nació desde PM como componente esperado, aunque todavía no tenga evidencia formal completa."
    : `Nació desde evidencia secundaria (${formatEnumLabel(item.originMode)}) porque la expectativa PM no alcanzó para originarlo sola.`;

  return {
    summary,
    bullets: [
      `Origen de nacimiento: ${bornFromPm ? "PM / ficha" : formatEnumLabel(item.originMode)}`,
      `Aplica para el caso: ${applies}`,
      `Estado de expectativa: ${expected}`
    ]
  };
}

function buildMatchingLayer(item: EvaluatedItemRecord) {
  const primaryEvidence = item.evidences.find((evidence) => evidence.isPrimary) ?? item.evidences[0] ?? null;
  const matchStatus = primaryEvidence?.matchStatus ?? item.matchingStatus;
  const matchRule = primaryEvidence?.matchRule ?? null;
  const matchConfidence = primaryEvidence?.matchConfidence ?? null;
  const sourceLabel = primaryEvidence ? sourceLabelForKey(primaryEvidence.sourceType) : sourceLabelForKey(item.originMode);

  const summary =
    matchStatus === MatchingStatus.AMBIGUOUS
      ? `El matching quedó ambiguo entre evidencias del caso y requiere revisión manual antes de confiar en la reconciliación.`
      : matchStatus === MatchingStatus.MANUAL_REVIEW
        ? `El matching todavía necesita revisión manual porque no alcanzó confianza suficiente.`
        : matchStatus === MatchingStatus.INFERRED
          ? `El item quedó reconciliado por inferencia usando ${sourceLabel}, con confianza operativa intermedia.`
          : `El item quedó reconciliado de forma consistente con ${sourceLabel}.`;

  const bullets = [
    `Fuente principal de match: ${sourceLabel}`,
    `Regla usada: ${matchRule ? formatEnumLabel(matchRule) : "sin regla explícita"}`,
    `Confianza: ${matchConfidence ? formatEnumLabel(matchConfidence) : "sin dato"}`,
    `Estado de matching: ${formatEnumLabel(matchStatus)}`
  ];

  if (matchStatus === MatchingStatus.AMBIGUOUS || matchStatus === MatchingStatus.MANUAL_REVIEW) {
    bullets.push("Resultado: requiere intervención manual para cerrar la identificación.");
  }

  return {
    summary,
    bullets
  };
}

function buildEvidencesLayer(item: EvaluatedItemRecord) {
  const presentSourceKeys = collectEvidenceSourceKeys(item);
  const available = SOURCE_CATALOG.filter((entry) => presentSourceKeys.has(entry.key)).map((entry) => entry.label);
  const missing = SOURCE_CATALOG.filter((entry) => !presentSourceKeys.has(entry.key)).map((entry) => entry.label);
  const summary =
    available.length === 0
      ? "Todavía no hay evidencia operativa consolidada fuera del registro del item."
      : missing.length === 0
        ? `El item ya tiene cobertura en todas las fuentes operativas principales: ${joinLabels(available)}.`
        : `Hay evidencia en ${joinLabels(available)}. Todavía faltan ${joinLabels(missing)}.`;

  return {
    summary,
    available,
    missing
  };
}

function buildDimensionReason(item: EvaluatedItemRecord, dimension: DimensionEvaluation) {
  switch (dimension.key) {
    case "definition":
      if (dimension.status === "inconsistent") {
        return "La definición quedó inconsistente porque el matching del componente es ambiguo entre fuentes.";
      }

      if (dimension.status === "missing") {
        return "La definición operativa sigue incompleta o requiere revisión manual antes de seguir consolidando.";
      }

      if (dimension.status === "partial") {
        return "La definición existe, pero todavía está inferida y conviene confirmarla con evidencia más fuerte.";
      }

      if (dimension.status === "ready") {
        return "El componente está suficientemente definido para sostener el seguimiento operativo.";
      }

      return "La definición no aplica para este item.";
    case "codification":
      if (dimension.status === "ready") {
        return `La codificación está resuelta porque ya existe material identificado (${item.materialMaster?.materialCode ?? "código asignado"}).`;
      }

      if (dimension.status === "partial") {
        return `Hay avance de codificación (${item.materialRequest?.requestCode ?? item.provisionalCode ?? "pedido en curso"}), pero todavía no existe material definitivo formalizado.`;
      }

      if (dimension.status === "missing") {
        return "El componente requiere código, pero todavía no existe pedido de alta ni señal equivalente.";
      }

      return "La codificación no aplica para este item.";
    case "pre_sap_structure":
      if (dimension.status === "ready") {
        return `La estructura pre-SAP ya existe en BOM operativa (${item.bomItem?.componentKey ?? item.bomItem?.componentName ?? "registrada"}).`;
      }

      if (dimension.status === "partial") {
        return "La estructura pre-SAP ya fue armada, pero sigue con confirmaciones pendientes.";
      }

      if (dimension.status === "missing") {
        return "Todavía no existe una receta o pre-BOM operativa que respalde el componente.";
      }

      return "La estructura pre-SAP no aplica para este item.";
    case "sap_formalization":
      if (dimension.status === "ready") {
        return `La formalización está resuelta porque ya existe material en SAP (${item.materialMaster?.sapMaterial?.materialCode ?? item.materialMaster?.materialCode ?? "material formal"}).`;
      }

      if (dimension.status === "inconsistent") {
        return "La formalización quedó inconsistente porque la fase operativa no coincide entre pre-SAP y SAP.";
      }

      if (dimension.status === "partial") {
        return "Hay señales previas de codificación o maestro interno, pero todavía no existe formalización suficiente en SAP.";
      }

      if (dimension.status === "missing") {
        return "Todavía no existe ninguna evidencia formal de material cargado en SAP.";
      }

      return "La formalización SAP no aplica para este item.";
    case "internal_technical_docs":
      if (dimension.status === "ready") {
        return "La documentación técnica interna está completa con plano, especificación y ficha técnica.";
      }

      if (dimension.status === "partial") {
        return `El material ya existe, pero la documentación técnica interna sigue incompleta (${dimension.signals.join(", ")}).`;
      }

      if (dimension.status === "missing") {
        return "Sin material identificado todavía no se puede completar la documentación técnica interna.";
      }

      return "La documentación técnica interna no aplica para este item.";
    case "documentation_review_approval":
      if (dimension.status === "ready") {
        return "La dimensión documental está lista porque ya existe documento aprobado.";
      }

      if (dimension.status === "blocked") {
        return dimension.signals.includes("review_overdue")
          ? "La revisión documental está vencida y bloquea el avance."
          : "Hay diseño completado sin revisión o una condición documental bloqueante.";
      }

      if (dimension.status === "partial") {
        return dimension.signals.includes("review_in_progress")
          ? "La revisión documental está en curso, pero todavía no existe una versión aprobada."
          : "Existe actividad documental, pero todavía no hay aprobación final.";
      }

      if (dimension.status === "missing") {
        return "Todavía no existe documentación aprobada ni workflow documental suficiente.";
      }

      return "La dimensión documental no aplica para este item.";
  }
}

function buildDecisionLayer(item: EvaluatedItemRecord, evaluation: ProjectItemEvaluation, dimensions: FunctionalValidationDimensionDiagnostic[]) {
  const nonReadyDimensions = dimensions.filter(
    (dimension) => dimension.status !== "ready" && dimension.status !== "not_applicable"
  );

  if (item.status === ProjectItemStatus.READY) {
    return {
      summary: "Quedó listo porque todas las dimensiones aplicables están en ready y no hay bloqueos abiertos.",
      blockers: []
    };
  }

  if (item.status === ProjectItemStatus.BLOCKED) {
    const reasons = [
      evaluation.blockers.includes("definition_blocked") ? "definición/matching" : null,
      evaluation.blockers.includes("documentation_blocked") ? "workflow documental" : null,
      evaluation.blockers.includes("sap_blocked") ? "formalización SAP" : null,
      evaluation.blockers.includes("blocking_checks") ? "checks bloqueantes" : null,
      evaluation.blockers.includes("critical_alerts_open") ? "alertas críticas abiertas" : null
    ].filter(Boolean) as string[];

    return {
      summary: `Quedó bloqueado por ${joinLabels(reasons.length > 0 ? reasons : ["condiciones críticas del proceso"])}.`,
      blockers: reasons
    };
  }

  if (item.status === ProjectItemStatus.WAITING_CODE) {
    const codification = dimensions.find((dimension) => dimension.key === "codification");
    const sapFormalization = dimensions.find((dimension) => dimension.key === "sap_formalization");
    const clauses = [codification?.reason, sapFormalization?.status === "partial" ? sapFormalization.reason : null]
      .filter(Boolean)
      .slice(0, 2) as string[];

    return {
      summary: `Quedó esperando código porque ${joinLabels(clauses.map((clause) => lowerFirst(clause)))}.`,
      blockers: []
    };
  }

  if (item.status === ProjectItemStatus.WAITING_DOCS) {
    const docsReasons = dimensions
      .filter(
        (dimension) =>
          dimension.key === "internal_technical_docs" || dimension.key === "documentation_review_approval"
      )
      .filter((dimension) => dimension.status !== "ready" && dimension.status !== "not_applicable")
      .map((dimension) => lowerFirst(dimension.reason));

    return {
      summary: `Quedó esperando documentación porque ${joinLabels(docsReasons)}.`,
      blockers: []
    };
  }

  return {
    summary: `Sigue en progreso porque ${joinLabels(
      nonReadyDimensions.slice(0, 3).map((dimension) => lowerFirst(dimension.reason))
    )}.`,
    blockers: []
  };
}

function buildItemDiagnostic(params: {
  item: EvaluatedItemRecord;
  evaluation: ProjectItemEvaluation;
}): FunctionalValidationItemDiagnostic {
  const dimensionDiagnostics = params.evaluation.dimensions.map((dimension) => ({
    key: dimension.key,
    label: DIMENSION_LABELS[dimension.key],
    status: dimension.status,
    score: dimension.score,
    blocking: dimension.blocking,
    reason: buildDimensionReason(params.item, dimension),
    signals: dimension.signals,
    alerts: dimension.alerts.map((alert) => ({
      ruleCode: alert.ruleCode,
      type: alert.type,
      title: alert.title,
      message: alert.message,
      severity: alert.severity,
      problemClass: readProblemClassFromAlert(alert),
      dimension: readMetadataValue(alert.metadata, "dimension"),
      dimensionStatus: readMetadataValue(alert.metadata, "dimensionStatus")
    }))
  }));

  const evidences = params.item.evidences.map((evidence) => ({
    id: evidence.id,
    sourceType: evidence.sourceType,
    sourceLabel: sourceLabelForKey(evidence.sourceType),
    sourceRecordKey: evidence.sourceRecordKey,
    rawLabel: evidence.rawLabel ?? null,
    matchRule: evidence.matchRule ?? null,
    matchConfidence: evidence.matchConfidence ?? null,
    matchStatus: evidence.matchStatus,
    isPrimary: evidence.isPrimary,
    lastSeenAt: evidence.lastSeenAt
  }));

  const evidencesLayer = buildEvidencesLayer(params.item);

  const diagnostic: FunctionalValidationItemDiagnostic = {
    id: params.item.id,
    itemKey: params.item.itemKey,
    name: params.item.name,
    status: params.item.status,
    readinessScore: params.item.readinessScore,
    originMode: params.item.originMode,
    componentSlot: params.item.componentSlot,
    expectedStatus: params.item.expectedStatus,
    identificationStatus: params.item.identificationStatus,
    matchingStatus: params.item.matchingStatus,
    evidences,
    availableEvidenceSources: evidencesLayer.available,
    missingEvidenceSources: evidencesLayer.missing,
    alerts: params.evaluation.activeAlerts.map((alert) => ({
      ruleCode: alert.ruleCode,
      type: alert.type,
      title: alert.title,
      message: alert.message,
      severity: alert.severity,
      problemClass: readProblemClassFromAlert(alert),
      dimension: readMetadataValue(alert.metadata, "dimension"),
      dimensionStatus: readMetadataValue(alert.metadata, "dimensionStatus")
    })),
    blockers: params.evaluation.blockers,
    dimensions: dimensionDiagnostics,
    why: {
      expectation: buildExpectationLayer(params.item),
      matching: buildMatchingLayer(params.item),
      evidences: evidencesLayer,
      decision: buildDecisionLayer(params.item, params.evaluation, dimensionDiagnostics)
    }
  };

  return diagnostic;
}

function buildHealthSummary(breakdown: ProjectHealthBreakdown) {
  const clauses = [
    `cobertura esperada ${breakdown.coverageScore}`,
    `readiness promedio ${Math.round(breakdown.averageReadiness)}`,
    `${breakdown.blockedItems} item(s) bloqueados`,
    `${breakdown.inconsistencyAlerts + breakdown.ambiguousItems + breakdown.manualReviewItems} desalineaciones`
  ];

  if (breakdown.expectedButUncoveredItems > 0) {
    clauses.push(`${breakdown.expectedButUncoveredItems} esperado(s) sin evidencia`);
  }

  return `Health ${breakdown.healthScore} por ${joinLabels(clauses)}.`;
}

function validateItemExpectation(item: FunctionalValidationItemDiagnostic | undefined, expected: FunctionalScenarioItemExpectation, details: string[]) {
  if (!item) {
    details.push(`Missing evaluated item ${expected.itemKey}`);
    return;
  }

  if (item.originMode !== expected.originMode) {
    details.push(`${item.itemKey}: originMode ${item.originMode} != expected ${expected.originMode}`);
  }

  if (item.expectedStatus !== expected.expectedStatus) {
    details.push(`${item.itemKey}: expectedStatus ${item.expectedStatus} != expected ${expected.expectedStatus}`);
  }

  if (item.matchingStatus !== expected.matchingStatus) {
    details.push(`${item.itemKey}: matchingStatus ${item.matchingStatus} != expected ${expected.matchingStatus}`);
  }

  if (item.status !== expected.expectedItemStatus) {
    details.push(`${item.itemKey}: status ${item.status} != expected ${expected.expectedItemStatus}`);
  }

  if (!inRange(item.readinessScore, expected.readinessRange)) {
    details.push(
      `${item.itemKey}: readiness ${item.readinessScore} outside expected range ${expected.readinessRange[0]}-${expected.readinessRange[1]}`
    );
  }

  const itemRuleCodes = new Set(item.alerts.map((alert) => alert.ruleCode).filter(Boolean));

  for (const requiredAlert of expected.requiredAlerts) {
    if (!itemRuleCodes.has(requiredAlert)) {
      details.push(`${item.itemKey}: missing expected alert ${requiredAlert}`);
    }
  }
}

function buildScenarioDiagnostic(scenario: FunctionalScenario): FunctionalValidationScenarioDiagnostic {
  const { evaluatedItems, projectForEvaluation } = buildProjectForEvaluation(scenario);
  const healthBreakdown = evaluateProjectHealthBreakdown(projectForEvaluation);
  const canClose = canCloseProject(projectForEvaluation);
  const itemDiagnostics = evaluatedItems.map((entry) => buildItemDiagnostic(entry));
  const details: string[] = [];

  for (const expectedItem of scenario.itemExpectations) {
    validateItemExpectation(
      itemDiagnostics.find((item) => item.itemKey === expectedItem.itemKey),
      expectedItem,
      details
    );
  }

  if (!inRange(healthBreakdown.healthScore, scenario.projectExpectation.healthRange)) {
    details.push(
      `project health ${healthBreakdown.healthScore} outside expected range ${scenario.projectExpectation.healthRange[0]}-${scenario.projectExpectation.healthRange[1]}`
    );
  }

  if (canClose !== scenario.projectExpectation.canClose) {
    details.push(`project canClose ${canClose} != expected ${scenario.projectExpectation.canClose}`);
  }

  return {
    id: scenario.id,
    title: scenario.title,
    summary: scenario.summary,
    passed: details.length === 0,
    details,
    project: {
      id: projectForEvaluation.id,
      code: projectForEvaluation.code,
      name: projectForEvaluation.name,
      caseType: projectForEvaluation.caseType,
      scopeDefined: projectForEvaluation.scopeDefined,
      healthScore: healthBreakdown.healthScore,
      canClose,
      itemCount: projectForEvaluation.projectItems.length,
      expectedItemCount: healthBreakdown.expectedItems,
      evidencedItemCount: projectForEvaluation.projectItems.filter((item) => hasSecondaryEvidence(item)).length,
      blockedItemCount: healthBreakdown.blockedItems,
      openAlertCount: healthBreakdown.openAlerts,
      healthBreakdown,
      healthSummary: buildHealthSummary(healthBreakdown)
    },
    items: itemDiagnostics
  };
}

export function getFunctionalValidationDiagnostics(): FunctionalValidationDiagnosticsReport {
  const scenarios = functionalValidationScenarios.map((scenario) => buildScenarioDiagnostic(scenario));
  const passedScenarios = scenarios.filter((scenario) => scenario.passed).length;

  return {
    generatedAt: new Date(),
    evaluationDate: EVALUATION_DATE,
    totalScenarios: scenarios.length,
    passedScenarios,
    failedScenarios: scenarios.length - passedScenarios,
    scenarios
  };
}
