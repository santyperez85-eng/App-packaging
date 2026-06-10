import * as XLSX from "xlsx";
import { ComponentSlot } from "@prisma/client";

import { createBatchId, dateOrNull, normalizeText, stringOrNull } from "@/lib/utils";

type SheetMatrix = Array<Array<unknown>>;

export type AltaMatDomain =
  | "PACKAGING_COMPONENT"
  | "PACKAGING_MATERIAL"
  | "NON_PACKAGING"
  | "UNKNOWN";

export type AltaMatEvidenceRole = "COMPONENT_CODE_REQUEST" | "COMPONENT_MATERIAL_CODE_REQUEST";

export type AltaMatRawRow = {
  excelRow: number;
  codeToCreate: string | null;
  descriptionToCreate: string | null;
  referenceCode: string | null;
  referenceDescription: string | null;
  replacedCode: string | null;
  replacedDescription: string | null;
  reason: string | null;
  requestedBy: string | null;
  requestDate: Date | null;
  rawRequestDate: string | null;
  status: string | null;
  observations: string | null;
  bomReplacement: string | null;
  masterReplacement: string | null;
};

export type AltaMatPackagingCandidate = {
  row: AltaMatRawRow;
  componentSlot: ComponentSlot;
  domain: AltaMatDomain;
  evidenceRole: AltaMatEvidenceRole;
  contextMatch: "DIRECT_TOKEN" | "CARRIED_CONTEXT";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reason: string;
};

type IgnoredRow = {
  excelRow: number;
  reason: string;
  codeToCreate: string | null;
  descriptionToCreate: string | null;
};

export type AltaMatImportDiagnostics = {
  sourceFileName?: string;
  sheetName: string;
  projectCode: string;
  projectToken: string;
  excludeProjectTokens: string[];
  rowsParsed: number;
  contextRows: number;
  packagingUsefulRows: number;
  normalizedRows: number;
  ignoredRows: number;
  ignoredByReason: Record<string, number>;
  ignoredSamples: IgnoredRow[];
  candidates: Array<{
    excelRow: number;
    componentSlot: ComponentSlot;
    domain: AltaMatDomain;
    evidenceRole: AltaMatEvidenceRole;
    requestCode: string | null;
    requestedDescription: string | null;
    status: string | null;
    contextMatch: "DIRECT_TOKEN" | "CARRIED_CONTEXT";
    confidence: "HIGH" | "MEDIUM" | "LOW";
    reason: string;
  }>;
};

export type AltaMatImportPayload = {
  batchId: string;
  sourceFileName?: string;
  sheets: Array<{
    sheetName: string;
    rows: Record<string, unknown>[];
  }>;
};

export type AltaMatBuildResult = {
  payload: AltaMatImportPayload;
  diagnostics: AltaMatImportDiagnostics;
};

type BuildAltaMatPayloadParams = {
  workbookPath: string;
  projectCode: string;
  projectToken: string;
  /**
   * Tokens that invalidate el contexto aunque matchee projectToken.
   * Caso tipico: "PERPIEL HERIDAS" identifica al spray, pero "JABON"/"ESPUMA"
   * marcan productos hermanos con nombre calificado.
   */
  excludeProjectTokens?: string[];
  expectedComponentSlots: ComponentSlot[];
  batchId?: string;
  sheetName?: string;
  maxContextCarryRows?: number;
};

type ClassifiedRow = {
  domain: AltaMatDomain;
  componentSlot: ComponentSlot | null;
  evidenceRole: AltaMatEvidenceRole | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reason: string;
};

const DEFAULT_SHEET_NAME = "Alta de Mat";
const DATA_START_ROW_INDEX = 2;
const EMPTY_CONTEXT_SIGNATURE = "__empty_context__";
const MAX_IGNORED_SAMPLES = 20;

function normalizeForMatch(value: unknown) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function compactText(values: Array<string | null>) {
  return values.filter(Boolean).join(" ");
}

function cleanCell(value: unknown) {
  return stringOrNull(value);
}

function jsonValue(value: unknown): string | number | boolean | null {
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

function readRowsFromWorkbook(params: { workbookPath: string; sheetName: string }) {
  const workbook = XLSX.readFile(params.workbookPath, { cellDates: true });
  const worksheet = workbook.Sheets[params.sheetName];

  if (!worksheet) {
    throw new Error(`Alta de Mat sheet not found: ${params.sheetName}`);
  }

  return XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: null,
    raw: false,
    blankrows: false
  }) as SheetMatrix;
}

function parseAltaMatRows(rows: SheetMatrix): AltaMatRawRow[] {
  return rows
    .slice(DATA_START_ROW_INDEX)
    .map((row, index) => {
      const requestDateValue = row[8];

      return {
        excelRow: index + DATA_START_ROW_INDEX + 1,
        codeToCreate: cleanCell(row[0]),
        descriptionToCreate: cleanCell(row[1]),
        referenceCode: cleanCell(row[2]),
        referenceDescription: cleanCell(row[3]),
        replacedCode: cleanCell(row[4]),
        replacedDescription: cleanCell(row[5]),
        reason: cleanCell(row[6]),
        requestedBy: cleanCell(row[7]),
        requestDate: dateOrNull(requestDateValue),
        rawRequestDate: cleanCell(requestDateValue),
        status: cleanCell(row[9]),
        observations: cleanCell(row[10]),
        bomReplacement: cleanCell(row[11]),
        masterReplacement: cleanCell(row[12])
      };
    })
    .filter((row) =>
      Boolean(
        row.codeToCreate ||
          row.descriptionToCreate ||
          row.referenceCode ||
          row.referenceDescription ||
          row.replacedCode ||
          row.replacedDescription ||
          row.reason ||
          row.requestedBy ||
          row.rawRequestDate ||
          row.status ||
          row.observations
      )
    );
}

function searchableText(row: AltaMatRawRow) {
  return normalizeForMatch(
    compactText([
      row.codeToCreate,
      row.descriptionToCreate,
      row.referenceCode,
      row.referenceDescription,
      row.replacedCode,
      row.replacedDescription,
      row.reason,
      row.observations
    ])
  );
}

function hasProjectToken(row: AltaMatRawRow, projectToken: string) {
  const token = normalizeForMatch(projectToken);

  if (!token) {
    return false;
  }

  return ` ${searchableText(row)} `.includes(` ${token} `);
}

function contextSignature(row: AltaMatRawRow) {
  const signature = [
    normalizeForMatch(row.reason),
    normalizeForMatch(row.requestedBy),
    row.requestDate?.toISOString().slice(0, 10) ?? normalizeForMatch(row.rawRequestDate)
  ].join("|");

  return signature === "||" ? EMPTY_CONTEXT_SIGNATURE : signature;
}

function hasAnyToken(row: AltaMatRawRow, tokens: string[]) {
  return tokens.some((token) => hasProjectToken(row, token));
}

function detectContextRows(
  rows: AltaMatRawRow[],
  params: { projectToken: string; excludeProjectTokens?: string[]; maxContextCarryRows: number }
) {
  const contextRows = new Map<number, "DIRECT_TOKEN" | "CARRIED_CONTEXT">();
  const excludedRows = new Set<number>();
  const excludeTokens = params.excludeProjectTokens ?? [];

  rows.forEach((row, index) => {
    if (!hasProjectToken(row, params.projectToken)) {
      return;
    }

    if (hasAnyToken(row, excludeTokens)) {
      excludedRows.add(row.excelRow);
      return;
    }

    contextRows.set(row.excelRow, "DIRECT_TOKEN");

    const signature = contextSignature(row);

    if (signature === EMPTY_CONTEXT_SIGNATURE) {
      return;
    }

    let carriedRows = 0;

    for (let nextIndex = index + 1; nextIndex < rows.length; nextIndex += 1) {
      const nextRow = rows[nextIndex];

      if (!nextRow || contextSignature(nextRow) !== signature || hasProjectToken(nextRow, params.projectToken)) {
        break;
      }

      if (hasAnyToken(nextRow, excludeTokens)) {
        excludedRows.add(nextRow.excelRow);
        break;
      }

      contextRows.set(nextRow.excelRow, "CARRIED_CONTEXT");
      carriedRows += 1;

      if (carriedRows >= params.maxContextCarryRows) {
        break;
      }
    }
  });

  return { contextRows, excludedRows };
}

function startsWithAny(text: string, values: string[]) {
  return values.some((value) => text.startsWith(value));
}

function includesAny(text: string, values: string[]) {
  return values.some((value) => text.includes(value));
}

function classifyAltaMatRow(row: AltaMatRawRow): ClassifiedRow {
  const description = normalizeForMatch(row.descriptionToCreate);

  if (!description) {
    return {
      domain: "UNKNOWN",
      componentSlot: null,
      evidenceRole: null,
      confidence: "LOW",
      reason: "missing_description"
    };
  }

  if (startsWithAny(description, ["tc "])) {
    // TC = tecnica de control: documento tecnico, no componente de packaging,
    // aunque la descripcion nombre un componente (ej. "TC.ETIQUETADO FRASCO").
    return {
      domain: "NON_PACKAGING",
      componentSlot: null,
      evidenceRole: null,
      confidence: "HIGH",
      reason: "tc_technical_control_not_packaging"
    };
  }

  if (startsWithAny(description, ["est ", "est.", "estuche "]) || description.includes(" estuche ")) {
    return {
      domain: "PACKAGING_COMPONENT",
      componentSlot: ComponentSlot.ESTUCHE,
      evidenceRole: "COMPONENT_CODE_REQUEST",
      confidence: "HIGH",
      reason: "description_identifies_estuche"
    };
  }

  if (startsWithAny(description, ["prosp ", "prosp.", "prospecto "]) || description.includes(" prospecto ")) {
    return {
      domain: "PACKAGING_COMPONENT",
      componentSlot: ComponentSlot.PROSPECTO,
      evidenceRole: "COMPONENT_CODE_REQUEST",
      confidence: "HIGH",
      reason: "description_identifies_prospecto"
    };
  }

  if (startsWithAny(description, ["alum ", "alum.", "aluminio "]) || description.includes(" aluminio ")) {
    return {
      domain: "PACKAGING_COMPONENT",
      componentSlot: ComponentSlot.ALUMINIO,
      evidenceRole: "COMPONENT_CODE_REQUEST",
      confidence: "HIGH",
      reason: "description_identifies_aluminio"
    };
  }

  if (startsWithAny(description, ["etiq ", "etiq.", "etiqueta "]) || description.includes(" etiqueta ")) {
    return {
      domain: "PACKAGING_COMPONENT",
      componentSlot: ComponentSlot.ETIQUETA,
      evidenceRole: "COMPONENT_CODE_REQUEST",
      confidence: "HIGH",
      reason: "description_identifies_etiqueta"
    };
  }

  if (startsWithAny(description, ["fco ", "fco.", "frasco "]) || description.includes(" frasco ")) {
    return {
      domain: "PACKAGING_COMPONENT",
      componentSlot: ComponentSlot.FRASCO,
      evidenceRole: "COMPONENT_CODE_REQUEST",
      confidence: "HIGH",
      reason: "description_identifies_frasco"
    };
  }

  if (description.includes("calendario")) {
    return {
      domain: "PACKAGING_COMPONENT",
      componentSlot: ComponentSlot.CALENDARIO,
      evidenceRole: "COMPONENT_CODE_REQUEST",
      confidence: "HIGH",
      reason: "description_identifies_calendario"
    };
  }

  if (description.includes("sobre") && description.includes("blist")) {
    return {
      domain: "PACKAGING_COMPONENT",
      componentSlot: ComponentSlot.PORTA_BLISTER,
      evidenceRole: "COMPONENT_CODE_REQUEST",
      confidence: "MEDIUM",
      reason: "description_identifies_porta_blister"
    };
  }

  if (includesAny(description, ["p v c", "pvc", "aclar", "pvdc"])) {
    return {
      domain: "PACKAGING_MATERIAL",
      componentSlot: ComponentSlot.BLISTER,
      evidenceRole: "COMPONENT_MATERIAL_CODE_REQUEST",
      confidence: "MEDIUM",
      reason: "description_identifies_blister_material"
    };
  }

  if (description.includes("capsula")) {
    return {
      domain: "NON_PACKAGING",
      componentSlot: null,
      evidenceRole: null,
      confidence: "LOW",
      reason: "capsule_or_raw_component_not_pm_packaging"
    };
  }

  return {
    domain: "UNKNOWN",
    componentSlot: null,
    evidenceRole: null,
    confidence: "LOW",
    reason: "no_supported_packaging_signal"
  };
}

function isWeakCode(value: string | null) {
  const normalized = normalizeForMatch(value).toUpperCase();

  return !normalized || normalized.includes("XXX") || normalized === "EXX" || normalized === "N A" || normalized === "NA";
}

function normalizeRequestStatus(status: string | null) {
  const normalized = normalizeForMatch(status);

  if (normalized === "ok" || normalized === "ok revisar") {
    return "COMPLETED";
  }

  if (normalized === "sin dar de alta" || normalized === "-") {
    return "REQUESTED";
  }

  return status ?? "REQUESTED";
}

function addIgnored(ignoredRows: IgnoredRow[], ignoredByReason: Record<string, number>, row: AltaMatRawRow, reason: string) {
  ignoredByReason[reason] = (ignoredByReason[reason] ?? 0) + 1;

  if (ignoredRows.length < MAX_IGNORED_SAMPLES) {
    ignoredRows.push({
      excelRow: row.excelRow,
      reason,
      codeToCreate: row.codeToCreate,
      descriptionToCreate: row.descriptionToCreate
    });
  }
}

function buildNormalizedRow(params: {
  row: AltaMatRawRow;
  candidate: AltaMatPackagingCandidate;
  projectCode: string;
  projectToken: string;
  sourceFileName?: string;
  sheetName: string;
}) {
  const sourceRecordKey = `alta-mat:${params.sheetName}:${params.row.excelRow}:${params.row.codeToCreate ?? "sin-codigo"}`;

  return {
    project_code: params.projectCode,
    request_code: params.row.codeToCreate,
    request_date: params.row.requestDate?.toISOString() ?? params.row.rawRequestDate,
    requested_by: params.row.requestedBy,
    material_type: params.candidate.componentSlot,
    requested_description: params.row.descriptionToCreate,
    request_status: normalizeRequestStatus(params.row.status),
    component_slot: params.candidate.componentSlot,
    rawData: {
      sourceRecordKey,
      sourceNormalization: {
        explicitComponentSlot: params.candidate.componentSlot,
        explicitComponentSlotSourceValue: params.row.descriptionToCreate
      },
      altaMat: {
        sourceFileName: params.sourceFileName ?? null,
        sheetName: params.sheetName,
        excelRow: params.row.excelRow,
        projectToken: params.projectToken,
        domain: params.candidate.domain,
        evidenceRole: params.candidate.evidenceRole,
        contextMatch: params.candidate.contextMatch,
        matchOnlyExpectedPmItems: true,
        shouldCreateProjectItem: false,
        confidence: params.candidate.confidence,
        classificationReason: params.candidate.reason,
        codeQuality: isWeakCode(params.row.codeToCreate) ? "WEAK_OR_PLACEHOLDER" : "PROVISIONAL",
        physicalRow: {
          codeToCreate: params.row.codeToCreate,
          descriptionToCreate: params.row.descriptionToCreate,
          referenceCode: params.row.referenceCode,
          referenceDescription: params.row.referenceDescription,
          replacedCode: params.row.replacedCode,
          replacedDescription: params.row.replacedDescription,
          reason: params.row.reason,
          requestedBy: params.row.requestedBy,
          requestDate: params.row.requestDate?.toISOString() ?? params.row.rawRequestDate,
          status: params.row.status,
          observations: params.row.observations,
          bomReplacement: params.row.bomReplacement,
          masterReplacement: params.row.masterReplacement
        }
      }
    }
  };
}

export function buildAltaMatMaterialRequestImportPayload(params: BuildAltaMatPayloadParams): AltaMatBuildResult {
  const sheetName = params.sheetName ?? DEFAULT_SHEET_NAME;
  const sourceFileName = params.workbookPath.split("/").pop();
  const expectedSlots = new Set(params.expectedComponentSlots);
  const matrixRows = readRowsFromWorkbook({
    workbookPath: params.workbookPath,
    sheetName
  });
  const rawRows = parseAltaMatRows(matrixRows);
  const { contextRows, excludedRows } = detectContextRows(rawRows, {
    projectToken: params.projectToken,
    excludeProjectTokens: params.excludeProjectTokens,
    maxContextCarryRows: params.maxContextCarryRows ?? 3
  });
  const ignoredByReason: Record<string, number> = {};
  const ignoredSamples: IgnoredRow[] = [];
  const candidates: AltaMatPackagingCandidate[] = [];
  const normalizedRows: Record<string, unknown>[] = [];

  for (const row of rawRows) {
    const contextMatch = contextRows.get(row.excelRow);

    if (!contextMatch) {
      addIgnored(
        ignoredSamples,
        ignoredByReason,
        row,
        excludedRows.has(row.excelRow) ? "excluded_by_negative_token" : "outside_project_context"
      );
      continue;
    }

    const classification = classifyAltaMatRow(row);

    if (classification.domain !== "PACKAGING_COMPONENT" && classification.domain !== "PACKAGING_MATERIAL") {
      addIgnored(ignoredSamples, ignoredByReason, row, `non_packaging:${classification.reason}`);
      continue;
    }

    if (!classification.componentSlot || !classification.evidenceRole) {
      addIgnored(ignoredSamples, ignoredByReason, row, "packaging_without_supported_slot");
      continue;
    }

    if (!expectedSlots.has(classification.componentSlot)) {
      addIgnored(ignoredSamples, ignoredByReason, row, `slot_not_expected_by_pm:${classification.componentSlot}`);
      continue;
    }

    const candidate = {
      row,
      componentSlot: classification.componentSlot,
      domain: classification.domain,
      evidenceRole: classification.evidenceRole,
      contextMatch,
      confidence: classification.confidence,
      reason: classification.reason
    } satisfies AltaMatPackagingCandidate;

    candidates.push(candidate);
    normalizedRows.push(
      buildNormalizedRow({
        row,
        candidate,
        projectCode: params.projectCode,
        projectToken: params.projectToken,
        sourceFileName,
        sheetName
      })
    );
  }

  return {
    payload: {
      batchId: params.batchId ?? createBatchId("alta-mat"),
      sourceFileName,
      sheets: [
        {
          sheetName,
          rows: normalizedRows
        }
      ]
    },
    diagnostics: {
      sourceFileName,
      sheetName,
      projectCode: params.projectCode,
      projectToken: params.projectToken,
      excludeProjectTokens: params.excludeProjectTokens ?? [],
      rowsParsed: rawRows.length,
      contextRows: contextRows.size,
      packagingUsefulRows: candidates.length,
      normalizedRows: normalizedRows.length,
      ignoredRows: rawRows.length - normalizedRows.length,
      ignoredByReason,
      ignoredSamples,
      candidates: candidates.map((candidate) => ({
        excelRow: candidate.row.excelRow,
        componentSlot: candidate.componentSlot,
        domain: candidate.domain,
        evidenceRole: candidate.evidenceRole,
        requestCode: candidate.row.codeToCreate,
        requestedDescription: candidate.row.descriptionToCreate,
        status: candidate.row.status,
        contextMatch: candidate.contextMatch,
        confidence: candidate.confidence,
        reason: candidate.reason
      }))
    }
  };
}

export function previewAltaMatRow(row: AltaMatRawRow) {
  return {
    excelRow: row.excelRow,
    cells: [
      row.codeToCreate,
      row.descriptionToCreate,
      row.referenceCode,
      row.referenceDescription,
      row.replacedCode,
      row.replacedDescription,
      row.reason,
      row.requestedBy,
      row.requestDate?.toISOString() ?? row.rawRequestDate,
      row.status,
      row.observations,
      row.bomReplacement,
      row.masterReplacement
    ].map(jsonValue)
  };
}
