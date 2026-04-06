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
  pm_component_flag: 30,
  pm_component_description: 25,
  pm_component_list: 10
};

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
    label: chooseLabel(existing.label, nextValue.label, existing.label)
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

  return Array.from(components.values())
    .filter((component) => component.applicabilityStatus === ApplicabilityStatus.APPLIES)
    .sort((left, right) => left.componentSlot.localeCompare(right.componentSlot))
    .map((component) => ({
      ...component,
      label: component.label || `${context.projectName} ${component.componentSlot}` || context.projectCode
    }));
}
