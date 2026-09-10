import { AlertStatus, Prisma } from "@prisma/client";

/**
 * Checklist de cierre de un componente.
 *
 * El proceso de packaging **no es lineal**: el orden en que se piden codigos, se
 * carga la receta, se disena el arte o se formaliza en SAP puede variar entre
 * proyectos. Lo que no varia es el conjunto de requisitos que hay que cumplir
 * para dar un componente por cerrado.
 *
 * Por eso este modulo no habla de "en que etapa esta" ni de "donde esta trabado"
 * — hablar de un unico punto de bloqueo asume una secuencia que no existe y
 * puede senalar un requisito cualquiera mientras el trabajo avanza por otro
 * lado. Habla de que falta, sin orden implicito.
 */

export type ClosureRequirementKey =
  | "code_requested"
  | "code_formalized"
  | "recipe_structure"
  | "approved_art"
  | "specification"
  | "drawing";

export type ClosureRequirementStatus = "met" | "missing" | "at_risk" | "not_applicable";

/**
 * Nombre corto de cada requisito, para cuando hay que listar varios juntos
 * ("Falta: Receta · Arte") o encabezar una columna. El label largo se usa
 * cuando el requisito se muestra solo.
 */
export const CLOSURE_REQUIREMENT_SHORT_LABELS: Record<ClosureRequirementKey, string> = {
  code_requested: "Alta",
  code_formalized: "SAP",
  recipe_structure: "Receta",
  approved_art: "Arte",
  specification: "Especificación",
  drawing: "Plano"
};

/** Orden fijo de los requisitos. No es una secuencia: es el orden de lectura. */
export const CLOSURE_REQUIREMENT_ORDER: ClosureRequirementKey[] = [
  "code_requested",
  "code_formalized",
  "recipe_structure",
  "approved_art",
  "specification",
  "drawing"
];

export type ClosureRequirement = {
  key: ClosureRequirementKey;
  label: string;
  status: ClosureRequirementStatus;
  /** Que se vio (o no) para decidir. Es lo que se muestra al usuario. */
  detail: string;
  source: string;
};

export type ClosureChecklist = {
  requirements: ClosureRequirement[];
  applicable: number;
  met: number;
  missing: string[];
  /** Requisitos cumplidos pero con una señal que amerita revision. */
  atRisk: string[];
  readyToClose: boolean;
};

export const CLOSURE_CHECKLIST_INCLUDE = {
  bomItem: true,
  materialRequest: true,
  materialMaster: { include: { sapMaterial: true } },
  evidences: true,
  alerts: true,
  moondeskTasks: { include: { documents: true } }
} as const satisfies Prisma.ProjectItemInclude;

type ChecklistRecord = Prisma.ProjectItemGetPayload<{ include: typeof CLOSURE_CHECKLIST_INCLUDE }>;

function hasEvidence(item: ChecklistRecord, sourceType: string) {
  return item.evidences.some((evidence) => evidence.sourceType === sourceType);
}

function hasOpenAlert(item: ChecklistRecord, ruleCode: string) {
  return item.alerts.some((alert) => alert.status === AlertStatus.OPEN && alert.ruleCode === ruleCode);
}

function codeRequested(item: ChecklistRecord): ClosureRequirement {
  const met = Boolean(item.materialRequest) || hasEvidence(item, "material_request");

  return {
    key: "code_requested",
    label: "Código pedido",
    status: met ? "met" : "missing",
    detail: met
      ? `Pedido de código ${item.materialRequest?.requestCode ?? "registrado"}.`
      : "No hay alta de código para este componente.",
    source: "Alta de código"
  };
}

function codeFormalized(item: ChecklistRecord): ClosureRequirement {
  const sap = item.materialMaster?.sapMaterial;

  if (!sap) {
    return {
      key: "code_formalized",
      label: "Código formalizado en SAP",
      status: "missing",
      detail: "El material no aparece en el último corte del maestro de SAP.",
      source: "SAP"
    };
  }

  if (sap.deletionFlag) {
    return {
      key: "code_formalized",
      label: "Código formalizado en SAP",
      status: "at_risk",
      detail: `El código ${sap.materialCode} figura con marca de borrado: se pidió por error y hay que corregirlo.`,
      source: "SAP"
    };
  }

  if (sap.discontinued) {
    return {
      key: "code_formalized",
      label: "Código formalizado en SAP",
      status: "at_risk",
      detail: `El material ${sap.materialCode} está discontinuado (grupo 051): hay que definir el reemplazo.`,
      source: "SAP"
    };
  }

  return {
    key: "code_formalized",
    label: "Código formalizado en SAP",
    status: "met",
    detail: `${sap.materialCode} vigente en SAP.`,
    source: "SAP"
  };
}

function recipeStructure(item: ChecklistRecord): ClosureRequirement {
  const met = Boolean(item.bomItem) || hasEvidence(item, "bom");
  const pending = hasOpenAlert(item, "PRE_BOM_PENDING_CONFIRMATION");

  if (met && pending) {
    return {
      key: "recipe_structure",
      label: "Estructura en receta",
      status: "at_risk",
      detail: "El componente está en la receta, pero el bloque conserva confirmaciones pendientes.",
      source: "Recetas"
    };
  }

  return {
    key: "recipe_structure",
    label: "Estructura en receta",
    status: met ? "met" : "missing",
    detail: met
      ? "El componente forma parte de la estructura de la receta."
      : "El componente todavía no está cargado en la receta.",
    source: "Recetas"
  };
}

function approvedArt(item: ChecklistRecord): ClosureRequirement {
  if (!item.requiresApprovedDocument) {
    return {
      key: "approved_art",
      label: "Arte aprobado",
      status: "not_applicable",
      detail: "El componente no lleva impresión, así que no tiene arte propio.",
      source: "Moondesk"
    };
  }

  const approved = item.moondeskTasks.some(
    (task) => task.approvedVersionAvailable || task.documents.some((document) => document.approved)
  );
  const inProgress = item.moondeskTasks.length > 0;

  if (approved) {
    return {
      key: "approved_art",
      label: "Arte aprobado",
      status: "met",
      detail: "Moondesk reporta el arte aprobado.",
      source: "Moondesk"
    };
  }

  return {
    key: "approved_art",
    label: "Arte aprobado",
    status: "missing",
    detail: inProgress
      ? "Hay actividad de diseño en Moondesk, pero todavía sin versión aprobada."
      : "No hay actividad de diseño registrada en Moondesk.",
    source: "Moondesk"
  };
}

/**
 * Especificacion y plano salen de la carpeta DOCUMENTOS APROBADOS. Sin un codigo
 * de material no hay carpeta que mirar, y sin escaneo no se verifico nada: en
 * ninguno de esos dos casos corresponde afirmar que el documento falta.
 */
function documentAvailability(
  key: "specification" | "drawing",
  label: string,
  params: { materialCode: string | null; docs: ApprovedDocumentAvailability | null | undefined; present: boolean }
): ClosureRequirement {
  if (!params.materialCode) {
    return {
      key,
      label,
      status: "missing",
      detail: "El componente todavía no tiene código de material, así que no hay carpeta publicada que revisar.",
      source: "Documentos aprobados"
    };
  }

  if (!params.docs) {
    return {
      key,
      label,
      status: "missing",
      detail: `No hay carpeta publicada para ${params.materialCode} en DOCUMENTOS APROBADOS.`,
      source: "Documentos aprobados"
    };
  }

  return {
    key,
    label,
    status: params.present ? "met" : "missing",
    detail: params.present
      ? `Publicado en DOCUMENTOS APROBADOS/${params.docs.materialTypeFolder ?? "?"}/${params.docs.folderName ?? params.materialCode}.`
      : `La carpeta de ${params.materialCode} existe pero no tiene ${label.toLowerCase()}.`,
    source: "Documentos aprobados"
  };
}

/** Lo que el checklist necesita saber de la carpeta de documentos publicados. */
export type ApprovedDocumentAvailability = {
  materialTypeFolder: string | null;
  folderName: string | null;
  hasSpecification: boolean;
  hasDrawing: boolean;
};

/** Codigo por el que buscar la carpeta publicada, de mas a menos confiable. */
export function checklistMaterialCode(item: ChecklistRecord) {
  return (
    item.materialMaster?.materialCode ??
    item.expectedMaterialCode ??
    item.materialRequest?.linkedMaterialCode ??
    null
  );
}

export function evaluateClosureChecklist(
  item: ChecklistRecord,
  approvedDocs?: ApprovedDocumentAvailability | null
): ClosureChecklist {
  const materialCode = checklistMaterialCode(item);
  const requirements: ClosureRequirement[] = [
    codeRequested(item),
    codeFormalized(item),
    recipeStructure(item),
    approvedArt(item),
    documentAvailability("specification", "Especificación disponible", {
      materialCode,
      docs: approvedDocs,
      present: Boolean(approvedDocs?.hasSpecification)
    }),
    documentAvailability("drawing", "Plano disponible", {
      materialCode,
      docs: approvedDocs,
      present: Boolean(approvedDocs?.hasDrawing)
    })
  ];

  const applicableRequirements = requirements.filter((requirement) => requirement.status !== "not_applicable");

  return {
    requirements,
    applicable: applicableRequirements.length,
    met: applicableRequirements.filter((requirement) => requirement.status === "met").length,
    missing: applicableRequirements
      .filter((requirement) => requirement.status === "missing")
      .map((requirement) => requirement.label),
    atRisk: applicableRequirements
      .filter((requirement) => requirement.status === "at_risk")
      .map((requirement) => requirement.label),
    readyToClose: applicableRequirements.every((requirement) => requirement.status === "met")
  };
}
