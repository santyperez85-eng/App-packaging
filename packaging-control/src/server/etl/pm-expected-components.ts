import { ApplicabilityStatus, ComponentSlot } from "@prisma/client";

import { booleanOrNull, inferComponentSlot, normalizeText, stringOrNull } from "@/lib/utils";
import { getRowValue } from "@/server/etl/excel";

type PmExpectationContext = {
  projectCode: string;
  projectName: string;
};

export type PmExpectedComponent = {
  sourceRecordKey: string;
  componentSlot: ComponentSlot;
  label: string;
  applicabilityStatus: ApplicabilityStatus;
  definitionRule: string;
  traceability?: PmExpectedTraceability;
};

type PmExpectedTraceability = {
  source: "pm_raw_matrix" | "pm_structured_field";
  rule: string;
  componentSlot: ComponentSlot;
  sheetName?: string | null;
  templateType?: string | null;
  rowIndex?: number;
  columnIndex?: number | null;
  matchedKeyword?: string;
  matchedLabel?: string | null;
  matchedValue?: string | null;
  blockLabel?: string | null;
  confidence: "HIGH" | "MEDIUM";
  reason: string;
  rowPreview?: Array<string | number | boolean | null>;
};

type ComponentDefinition = {
  slot: ComponentSlot;
  defaultLabel: string;
  flagCandidates: string[];
  labelCandidates: string[];
};

const LIST_FIELD_CANDIDATES = [
  "packaging_components",
  "packaging_component_list",
  "componentes_packaging",
  "componentes packaging",
  "componentes_esperados",
  "componentes esperados",
  "expected_components",
  "expected packaging",
  "alcance_packaging",
  "scope_packaging"
];

const COMPONENT_DEFINITIONS: ComponentDefinition[] = [
  {
    slot: ComponentSlot.ESTUCHE,
    defaultLabel: "Estuche",
    flagCandidates: ["estuche", "aplica_estuche", "requiere_estuche", "box", "aplica_box"],
    labelCandidates: ["estuche_desc", "descripcion_estuche", "estuche_description", "box_description"]
  },
  {
    slot: ComponentSlot.PROSPECTO,
    defaultLabel: "Prospecto",
    flagCandidates: ["prospecto", "aplica_prospecto", "requiere_prospecto", "leaflet", "aplica_leaflet"],
    labelCandidates: ["prospecto_desc", "descripcion_prospecto", "leaflet_description"]
  },
  {
    slot: ComponentSlot.ETIQUETA,
    defaultLabel: "Etiqueta",
    flagCandidates: ["etiqueta", "aplica_etiqueta", "requiere_etiqueta", "label", "aplica_label"],
    labelCandidates: ["etiqueta_desc", "descripcion_etiqueta", "label_description"]
  },
  {
    slot: ComponentSlot.FRASCO,
    defaultLabel: "Frasco",
    flagCandidates: ["frasco", "aplica_frasco", "requiere_frasco", "bottle", "aplica_bottle"],
    labelCandidates: ["frasco_desc", "descripcion_frasco", "bottle_description"]
  },
  {
    slot: ComponentSlot.BLISTER,
    defaultLabel: "Blister",
    flagCandidates: ["blister", "aplica_blister", "requiere_blister"],
    labelCandidates: ["blister_desc", "descripcion_blister"]
  },
  {
    slot: ComponentSlot.ALUMINIO,
    defaultLabel: "Aluminio",
    flagCandidates: ["aluminio", "aplica_aluminio", "requiere_aluminio", "foil", "aplica_foil"],
    labelCandidates: ["aluminio_desc", "descripcion_aluminio", "foil_description"]
  },
  {
    slot: ComponentSlot.POMO,
    defaultLabel: "Pomo",
    flagCandidates: ["pomo", "aplica_pomo", "requiere_pomo"],
    labelCandidates: ["pomo_desc", "descripcion_pomo"]
  },
  {
    slot: ComponentSlot.FOLLETO,
    defaultLabel: "Folleto",
    flagCandidates: ["folleto", "aplica_folleto", "requiere_folleto"],
    labelCandidates: ["folleto_desc", "descripcion_folleto"]
  },
  {
    slot: ComponentSlot.INSERTO,
    defaultLabel: "Inserto",
    flagCandidates: ["inserto", "aplica_inserto", "requiere_inserto", "insert", "aplica_insert"],
    labelCandidates: ["inserto_desc", "descripcion_inserto", "insert_description"]
  },
  {
    slot: ComponentSlot.PORTA_BLISTER,
    defaultLabel: "Porta blister",
    flagCandidates: ["porta_blister", "porta blister", "aplica_porta_blister", "requiere_porta_blister"],
    labelCandidates: ["porta_blister_desc", "descripcion_porta_blister"]
  },
  {
    slot: ComponentSlot.CALENDARIO,
    defaultLabel: "Calendario",
    flagCandidates: ["calendario", "aplica_calendario", "requiere_calendario", "calendar", "aplica_calendar"],
    labelCandidates: ["calendario_desc", "descripcion_calendario", "calendar_description"]
  },
  {
    slot: ComponentSlot.OTRO,
    defaultLabel: "Otro",
    flagCandidates: ["otro", "aplica_otro", "requiere_otro", "others", "aplica_others"],
    labelCandidates: ["otro_desc", "descripcion_otro", "other_description"]
  }
];

const RULE_PRIORITY: Record<string, number> = {
  pm_matrix_yes_toggle: 80,
  pm_matrix_explicit_description: 75,
  pm_matrix_structured_quantity: 70,
  pm_matrix_material_description: 65,
  pm_component_flag: 30,
  pm_component_description: 25,
  pm_component_list: 10
};

const TARGET_MATRIX_SLOTS = [
  ComponentSlot.ESTUCHE,
  ComponentSlot.PROSPECTO,
  ComponentSlot.BLISTER,
  ComponentSlot.FRASCO,
  ComponentSlot.ALUMINIO,
  ComponentSlot.POMO
];

const MATRIX_SLOT_TERMS: Record<ComponentSlot, string[]> = {
  [ComponentSlot.ESTUCHE]: ["estuche", "est."],
  [ComponentSlot.PROSPECTO]: ["prospecto", "prosp.", "info paciente", "informacion paciente", "leaflet"],
  [ComponentSlot.BLISTER]: ["blister"],
  [ComponentSlot.FRASCO]: ["frasco", "fco."],
  [ComponentSlot.ALUMINIO]: ["aluminio", "foil", "alu"],
  [ComponentSlot.POMO]: ["pomo", "tubo"],
  [ComponentSlot.ETIQUETA]: [],
  [ComponentSlot.FOLLETO]: [],
  [ComponentSlot.INSERTO]: [],
  [ComponentSlot.PORTA_BLISTER]: [],
  [ComponentSlot.CALENDARIO]: [],
  [ComponentSlot.OTRO]: []
};

const NEGATIVE_VALUES = new Set(["no", "n", "0", "false", "sin", "no aplica", "n/a", "na"]);
const EMPTY_OR_OPTION_VALUES = new Set([
  "",
  "si",
  "no",
  "x",
  "a completar",
  "mkt",
  "dto medico",
  "largo",
  "ancho",
  "altura",
  "presentacion",
  "maquina",
  "formato",
  "gramaje",
  "g m2",
  "m2 kg",
  "desarrollo",
  "operaciones",
  "desarrollo operaciones",
  "mkt desarrollo",
  "mkt proyectos",
  "operaciones produccion"
]);

function buildSourceRecordKey(componentSlot: ComponentSlot) {
  return componentSlot;
}

function splitListValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => splitListValue(entry));
  }

  const normalizedValue = String(value ?? "").trim();

  if (!normalizedValue) {
    return [];
  }

  return normalizedValue
    .split(/[\n,;|]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getRows(rawData: Record<string, unknown>) {
  return Array.isArray(rawData.rows) ? rawData.rows.filter(Array.isArray) : [];
}

function normalizeForMatch(value: unknown) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function rowText(row: unknown[]) {
  return normalizeForMatch(row.map((cell) => String(cell ?? "")).join(" "));
}

function hasTerm(text: string, term: string) {
  const normalizedTerm = normalizeForMatch(term);

  if (!normalizedTerm) {
    return false;
  }

  return ` ${text} `.includes(` ${normalizedTerm} `);
}

function findMatchedTerm(text: string, terms: string[]) {
  return terms.find((term) => hasTerm(text, term)) ?? null;
}

function cleanCellValue(value: unknown) {
  const parsed = stringOrNull(value);

  if (!parsed) {
    return null;
  }

  return parsed.replace(/\s+/g, " ").trim();
}

function isMeaningfulValue(value: unknown) {
  const parsed = cleanCellValue(value);

  if (!parsed) {
    return false;
  }

  const normalized = normalizeForMatch(parsed);

  if (!normalized || EMPTY_OR_OPTION_VALUES.has(normalized) || NEGATIVE_VALUES.has(normalized)) {
    return false;
  }

  if (normalized.includes("responsable")) {
    return false;
  }

  return true;
}

function jsonCell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

function rowPreview(row: unknown[]) {
  return row.slice(0, 12).map(jsonCell);
}

function firstMatchingColumn(row: unknown[], terms: string[]) {
  for (let index = 0; index < row.length; index += 1) {
    const text = normalizeForMatch(row[index]);

    if (findMatchedTerm(text, terms)) {
      return index;
    }
  }

  return null;
}

function firstMeaningfulValue(row: unknown[], startColumn = 0) {
  for (let index = startColumn; index < row.length; index += 1) {
    if (isMeaningfulValue(row[index])) {
      return {
        columnIndex: index,
        value: cleanCellValue(row[index])
      };
    }
  }

  return null;
}

function firstDescriptiveCell(row: unknown[]) {
  for (let index = 0; index < row.length; index += 1) {
    const value = cleanCellValue(row[index]);

    if (!value || !isMeaningfulValue(value)) {
      continue;
    }

    if (value.length >= 18) {
      return {
        columnIndex: index,
        value
      };
    }
  }

  return null;
}

function findBlockLabel(rows: unknown[][], rowIndex: number) {
  const minRowIndex = Math.max(0, rowIndex - 8);

  for (let index = rowIndex; index >= minRowIndex; index -= 1) {
    const row = rows[index] ?? [];
    const value = cleanCellValue(row[1] ?? row[0]);

    if (value && isMeaningfulValue(value)) {
      return value;
    }
  }

  return null;
}

function findToggleDecision(rows: unknown[][], rowIndex: number) {
  const row = rows[rowIndex] ?? [];
  const yesColumn = row.findIndex((cell) => normalizeForMatch(cell) === "si");
  const noColumn = row.findIndex((cell) => normalizeForMatch(cell) === "no");

  if (yesColumn < 0 || noColumn < 0) {
    return null;
  }

  for (let offset = 1; offset <= 2; offset += 1) {
    const answerRow = rows[rowIndex + offset] ?? [];
    const yesValue = normalizeForMatch(answerRow[yesColumn]);
    const noValue = normalizeForMatch(answerRow[noColumn]);
    const yesSelected = ["x", "si", "yes", "1", "true"].includes(yesValue);
    const noSelected = ["x", "no", "1", "true"].includes(noValue);

    if (yesSelected && !noSelected) {
      return { applies: true, rowIndex: rowIndex + offset, columnIndex: yesColumn, value: cleanCellValue(answerRow[yesColumn]) };
    }

    if (noSelected && !yesSelected) {
      return { applies: false, rowIndex: rowIndex + offset, columnIndex: noColumn, value: cleanCellValue(answerRow[noColumn]) };
    }
  }

  return null;
}

function buildTraceability(params: {
  rawData: Record<string, unknown>;
  rule: string;
  componentSlot: ComponentSlot;
  rowIndex: number;
  columnIndex?: number | null;
  matchedKeyword: string;
  matchedLabel?: string | null;
  matchedValue?: string | null;
  confidence: "HIGH" | "MEDIUM";
  reason: string;
}) {
  const rows = getRows(params.rawData);

  return {
    source: "pm_raw_matrix",
    rule: params.rule,
    componentSlot: params.componentSlot,
    sheetName: stringOrNull(params.rawData.sheetName),
    templateType: stringOrNull(params.rawData.templateType),
    rowIndex: params.rowIndex + 1,
    columnIndex: params.columnIndex === undefined || params.columnIndex === null ? null : params.columnIndex + 1,
    matchedKeyword: params.matchedKeyword,
    matchedLabel: params.matchedLabel ?? null,
    matchedValue: params.matchedValue ?? null,
    blockLabel: findBlockLabel(rows, params.rowIndex),
    confidence: params.confidence,
    reason: params.reason,
    rowPreview: rowPreview(rows[params.rowIndex] ?? [])
  } satisfies PmExpectedTraceability;
}

function buildMatrixExpectation(params: {
  rawData: Record<string, unknown>;
  slot: ComponentSlot;
  label: string;
  rule: string;
  rowIndex: number;
  columnIndex?: number | null;
  matchedKeyword: string;
  matchedLabel?: string | null;
  matchedValue?: string | null;
  confidence?: "HIGH" | "MEDIUM";
  reason: string;
}) {
  return {
    sourceRecordKey: buildSourceRecordKey(params.slot),
    componentSlot: params.slot,
    label: params.label,
    applicabilityStatus: ApplicabilityStatus.APPLIES,
    definitionRule: params.rule,
    traceability: buildTraceability({
      rawData: params.rawData,
      rule: params.rule,
      componentSlot: params.slot,
      rowIndex: params.rowIndex,
      columnIndex: params.columnIndex,
      matchedKeyword: params.matchedKeyword,
      matchedLabel: params.matchedLabel,
      matchedValue: params.matchedValue,
      confidence: params.confidence ?? "HIGH",
      reason: params.reason
    })
  } satisfies PmExpectedComponent;
}

function defaultLabelForSlot(slot: ComponentSlot) {
  return COMPONENT_DEFINITIONS.find((definition) => definition.slot === slot)?.defaultLabel ?? slot;
}

function labelForSlot(slot: ComponentSlot, value?: string | null) {
  const defaultLabel = defaultLabelForSlot(slot);

  if (!value || normalizeText(value) === normalizeText(defaultLabel)) {
    return defaultLabel;
  }

  return `${defaultLabel} - ${value}`;
}

function isNumericLike(value: unknown) {
  const parsed = cleanCellValue(value);

  if (!parsed) {
    return false;
  }

  return /^\d+([,.]\d+)?$/.test(parsed);
}

function isGenericChoiceContext(text: string) {
  return (
    hasTerm(text, "tipo de presentacion") ||
    hasTerm(text, "tipo de envase") ||
    hasTerm(text, "presentaciones de originales") ||
    hasTerm(text, "presentaciones de muestras medicas")
  );
}

function detectStructuredBlisterQuantity(rawData: Record<string, unknown>, rowIndex: number) {
  const rows = getRows(rawData);
  const row = rows[rowIndex] ?? [];
  const headerColumns = row
    .map((cell, columnIndex) => ({ columnIndex, text: normalizeForMatch(cell), label: cleanCellValue(cell) }))
    .filter(({ text }) => hasTerm(text, "unid x blister") || hasTerm(text, "cant blister"));

  if (!headerColumns.length) {
    return null;
  }

  for (let offset = 1; offset <= 4; offset += 1) {
    const valueRowIndex = rowIndex + offset;
    const valueRow = rows[valueRowIndex] ?? [];
    const valueCells = headerColumns
      .map(({ columnIndex, label }) => ({
        columnIndex,
        label,
        value: cleanCellValue(valueRow[columnIndex])
      }))
      .filter(({ value }) => value && isNumericLike(value));

    if (!valueCells.length) {
      continue;
    }

    return buildMatrixExpectation({
      rawData,
      slot: ComponentSlot.BLISTER,
      label: "Blister",
      rule: "pm_matrix_structured_quantity",
      rowIndex: valueRowIndex,
      columnIndex: valueCells[0].columnIndex,
      matchedKeyword: valueCells[0].label ?? "Blister",
      matchedLabel: headerColumns.map(({ label }) => label).filter(Boolean).join(" / "),
      matchedValue: valueCells.map(({ label, value }) => `${label}: ${value}`).join(" | "),
      confidence: "MEDIUM",
      reason: "The PM matrix has blister quantity headers with numeric values in the product row."
    });
  }

  return null;
}

function detectMatrixSlotInRow(rawData: Record<string, unknown>, slot: ComponentSlot, rowIndex: number) {
  const rows = getRows(rawData);
  const row = rows[rowIndex] ?? [];
  const text = rowText(row);
  const terms = MATRIX_SLOT_TERMS[slot];
  const matchedKeyword = findMatchedTerm(text, terms);

  if (!matchedKeyword) {
    return { expectation: null, doesNotApply: false };
  }

  if (slot === ComponentSlot.BLISTER && (hasTerm(text, "porta blister") || hasTerm(text, "blistera"))) {
    return { expectation: null, doesNotApply: false };
  }

  if (slot === ComponentSlot.ALUMINIO && hasTerm(text, "induccion")) {
    // Disco/sello de induccion: integra el cierre (tapa), no pide codigo propio.
    return { expectation: null, doesNotApply: false };
  }

  const labelColumn = firstMatchingColumn(row, terms);
  const matchedLabel = labelColumn === null ? null : cleanCellValue(row[labelColumn]);
  const toggleDecision = findToggleDecision(rows, rowIndex);

  if (toggleDecision?.applies === false) {
    return { expectation: null, doesNotApply: true };
  }

  if (toggleDecision?.applies === true) {
    return {
      expectation: buildMatrixExpectation({
        rawData,
        slot,
        label: labelForSlot(slot, matchedLabel),
        rule: "pm_matrix_yes_toggle",
        rowIndex: toggleDecision.rowIndex,
        columnIndex: toggleDecision.columnIndex,
        matchedKeyword,
        matchedLabel,
        matchedValue: toggleDecision.value,
        reason: "The PM matrix has an explicit SI/NO row and the SI option is marked."
      }),
      doesNotApply: false
    };
  }

  if ((slot === ComponentSlot.FRASCO || slot === ComponentSlot.POMO) && isGenericChoiceContext(text)) {
    return { expectation: null, doesNotApply: false };
  }

  const valueAfterLabel = slot === ComponentSlot.ALUMINIO || slot === ComponentSlot.BLISTER
    ? null
    : labelColumn === null
      ? null
      : firstMeaningfulValue(row, labelColumn + 1);

  if (valueAfterLabel?.value) {
    return {
      expectation: buildMatrixExpectation({
        rawData,
        slot,
        label: labelForSlot(slot, valueAfterLabel.value),
        rule: "pm_matrix_explicit_description",
        rowIndex,
        columnIndex: valueAfterLabel.columnIndex,
        matchedKeyword,
        matchedLabel,
        matchedValue: valueAfterLabel.value,
        reason: "The component label has a non-empty descriptive value in the same PM row."
      }),
      doesNotApply: false
    };
  }

  const descriptiveCell = firstDescriptiveCell(row);

  if (
    descriptiveCell?.value &&
    (slot === ComponentSlot.BLISTER || slot === ComponentSlot.ALUMINIO) &&
    !hasTerm(text, "tipo de material")
  ) {
    return {
      expectation: buildMatrixExpectation({
        rawData,
        slot,
        label: labelForSlot(slot, descriptiveCell.value),
        rule: "pm_matrix_material_description",
        rowIndex,
        columnIndex: descriptiveCell.columnIndex,
        matchedKeyword,
        matchedLabel,
        matchedValue: descriptiveCell.value,
        confidence: "MEDIUM",
        reason: "The PM matrix has a packaging material description that names this component."
      }),
      doesNotApply: false
    };
  }

  return { expectation: null, doesNotApply: false };
}

function extractMatrixExpectedComponents(rawData: Record<string, unknown>) {
  const rows = getRows(rawData);
  const components = new Map<ComponentSlot, PmExpectedComponent>();
  const doesNotApplySlots = new Set<ComponentSlot>();

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const structuredBlisterExpectation = detectStructuredBlisterQuantity(rawData, rowIndex);

    if (structuredBlisterExpectation) {
      upsertExpectation(components, structuredBlisterExpectation);
    }

    for (const slot of TARGET_MATRIX_SLOTS) {
      const detection = detectMatrixSlotInRow(rawData, slot, rowIndex);

      if (detection.doesNotApply) {
        doesNotApplySlots.add(slot);
        continue;
      }

      if (detection.expectation) {
        upsertExpectation(components, detection.expectation);
      }
    }
  }

  for (const slot of doesNotApplySlots) {
    const expectation = components.get(slot);

    if (expectation?.definitionRule !== "pm_matrix_yes_toggle") {
      components.delete(slot);
    }
  }

  return Array.from(components.values());
}

function chooseLabel(currentLabel: string | undefined, candidateLabel: string, defaultLabel: string) {
  if (!currentLabel) {
    return candidateLabel;
  }

  if (normalizeText(currentLabel) === normalizeText(defaultLabel) && normalizeText(candidateLabel) !== normalizeText(defaultLabel)) {
    return candidateLabel;
  }

  return currentLabel;
}

function upsertExpectation(
  components: Map<ComponentSlot, PmExpectedComponent>,
  nextValue: PmExpectedComponent
) {
  const existing = components.get(nextValue.componentSlot);

  if (!existing) {
    components.set(nextValue.componentSlot, nextValue);
    return;
  }

  const existingPriority = RULE_PRIORITY[existing.definitionRule] ?? 0;
  const nextPriority = RULE_PRIORITY[nextValue.definitionRule] ?? 0;

  if (nextPriority > existingPriority) {
    components.set(nextValue.componentSlot, {
      ...nextValue,
      label: chooseLabel(existing.label, nextValue.label, nextValue.label)
    });
    return;
  }

  components.set(nextValue.componentSlot, {
    ...existing,
    label:
      nextPriority === existingPriority
        ? chooseLabel(existing.label, nextValue.label, defaultLabelForSlot(existing.componentSlot))
        : existing.label
  });
}

export function extractPmExpectedComponents(
  rawData: Record<string, unknown>,
  context: PmExpectationContext
): PmExpectedComponent[] {
  const components = new Map<ComponentSlot, PmExpectedComponent>();

  for (const definition of COMPONENT_DEFINITIONS) {
    const labelValue = stringOrNull(getRowValue(rawData, definition.labelCandidates));
    const flagValue = getRowValue(rawData, definition.flagCandidates);
    const booleanValue = booleanOrNull(flagValue);

    if (labelValue) {
      upsertExpectation(components, {
        sourceRecordKey: buildSourceRecordKey(definition.slot),
        componentSlot: definition.slot,
        label: labelValue,
        applicabilityStatus: ApplicabilityStatus.APPLIES,
        definitionRule: "pm_component_description"
      });
      continue;
    }

    if (booleanValue === true) {
      upsertExpectation(components, {
        sourceRecordKey: buildSourceRecordKey(definition.slot),
        componentSlot: definition.slot,
        label: definition.defaultLabel,
        applicabilityStatus: ApplicabilityStatus.APPLIES,
        definitionRule: "pm_component_flag"
      });
      continue;
    }

    if (booleanValue === false) {
      upsertExpectation(components, {
        sourceRecordKey: buildSourceRecordKey(definition.slot),
        componentSlot: definition.slot,
        label: definition.defaultLabel,
        applicabilityStatus: ApplicabilityStatus.DOES_NOT_APPLY,
        definitionRule: "pm_component_flag"
      });
    }
  }

  const listValue = getRowValue(rawData, LIST_FIELD_CANDIDATES);

  for (const entry of splitListValue(listValue)) {
    const componentSlot = inferComponentSlot(entry);

    if (componentSlot === ComponentSlot.OTRO) {
      continue;
    }

    upsertExpectation(components, {
      sourceRecordKey: buildSourceRecordKey(componentSlot),
      componentSlot,
      label: entry,
      applicabilityStatus: ApplicabilityStatus.APPLIES,
      definitionRule: "pm_component_list"
    });
  }

  for (const matrixComponent of extractMatrixExpectedComponents(rawData)) {
    upsertExpectation(components, matrixComponent);
  }

  return Array.from(components.values())
    .filter((component) => component.applicabilityStatus === ApplicabilityStatus.APPLIES)
    .sort((left, right) => left.componentSlot.localeCompare(right.componentSlot))
    .map((component) => ({
      ...component,
      label: component.label || `${context.projectName} ${component.componentSlot}` || context.projectCode
    }));
}
