import * as XLSX from "xlsx";
import { ComponentSlot } from "@prisma/client";

import { normalizeText, stringOrNull } from "@/lib/utils";

type SheetMatrix = Array<Array<unknown>>;

/**
 * Adaptador conservador para el reporte de tareas de Moondesk (export Excel).
 * Mientras la API de Moondesk se desarrolla, esta es la unica fuente: el reporte
 * "Reporte de tareas" que se puede consultar hoy. El adaptador NO crea project_items;
 * vincula cada documento a un item esperado por el PM, por componentSlot dentro del
 * proyecto, usando el Cod. Insumo y el tipo de documento como evidencia.
 */

const DEFAULT_SHEET_NAME_HINT = "reporte";

// Mapea "Tipo de Documento" / "Tipo de material" del reporte a ComponentSlot.
const DOC_TYPE_TO_SLOT: Array<{ match: string[]; slot: ComponentSlot }> = [
  { match: ["estuche"], slot: ComponentSlot.ESTUCHE },
  { match: ["prospecto"], slot: ComponentSlot.PROSPECTO },
  { match: ["etiqueta"], slot: ComponentSlot.ETIQUETA },
  { match: ["aluminio"], slot: ComponentSlot.ALUMINIO },
  { match: ["sobre portablister", "portablister"], slot: ComponentSlot.PORTA_BLISTER },
  { match: ["frasco"], slot: ComponentSlot.FRASCO },
  { match: ["pomo"], slot: ComponentSlot.POMO },
  { match: ["folia"], slot: ComponentSlot.INSERTO },
  { match: ["doypack"], slot: ComponentSlot.OTRO }
];

// Tipos de documento que NO representan un componente de packaging con slot propio.
const NON_PACKAGING_DOC_TYPES = ["plano", "especificacion", "ft", "base de carton", "neceser", "cepillo", "hilo dental", "palillo interdental"];

export type MoondeskApprovalState = "APPROVED" | "IN_REVIEW" | "CHANGES_REQUESTED" | "UNKNOWN";

export type MoondeskTaskRow = {
  excelRow: number;
  taskNumber: string | null;
  taskName: string | null;
  taskStatus: string | null;
  documentNumber: string | null;
  documentType: string | null;
  drawingCode: string | null;
  description: string | null;
  presentation: string | null;
  product: string | null;
  materialType: string | null;
  materialCode: string | null;
  subtaskStatus: string | null;
  approvedBy: string | null;
  changeRequestedBy: string | null;
  pendingWith: string | null;
  approvalDateSerial: number | null;
  latestVersion: string | null;
};

export type MoondeskTaskCandidate = {
  row: MoondeskTaskRow;
  componentSlot: ComponentSlot;
  approvalState: MoondeskApprovalState;
  approved: boolean;
};

type IgnoredMoondeskRow = {
  excelRow: number;
  reason: string;
  documentType: string | null;
  materialCode: string | null;
};

export type MoondeskReportDiagnostics = {
  sourceFileName?: string;
  sheetName: string;
  projectToken: string;
  rowsParsed: number;
  projectRows: number;
  packagingCandidates: number;
  ignoredRows: number;
  ignoredByReason: Record<string, number>;
  ignoredSamples: IgnoredMoondeskRow[];
  candidates: Array<{
    excelRow: number;
    componentSlot: ComponentSlot;
    materialCode: string | null;
    documentType: string | null;
    approvalState: MoondeskApprovalState;
    approved: boolean;
  }>;
};

export type MoondeskReportResult = {
  candidates: MoondeskTaskCandidate[];
  diagnostics: MoondeskReportDiagnostics;
};

type BuildMoondeskReportParams = {
  workbookPath: string;
  projectToken: string;
  /** Slots esperados por el PM: solo se conservan candidatos de estos slots. */
  expectedComponentSlots: ComponentSlot[];
  sheetName?: string;
  excludeProjectTokens?: string[];
};

function normalizeForMatch(value: unknown) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function readMatrix(workbookPath: string, sheetName?: string): { sheetName: string; matrix: SheetMatrix } {
  const workbook = XLSX.readFile(workbookPath);
  const resolvedSheetName =
    sheetName ??
    workbook.SheetNames.find((name) => normalizeForMatch(name).includes(DEFAULT_SHEET_NAME_HINT)) ??
    workbook.SheetNames[0];
  const worksheet = workbook.Sheets[resolvedSheetName];

  if (!worksheet) {
    throw new Error(`Moondesk sheet not found: ${resolvedSheetName}`);
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: null,
    raw: true
  });

  return { sheetName: resolvedSheetName, matrix };
}

// El reporte trae metadata arriba; la tabla real arranca en la fila cuyo encabezado
// incluye "Numero de Tarea". Detectamos esa fila y mapeamos columnas por nombre.
function locateHeader(matrix: SheetMatrix) {
  for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 40); rowIndex += 1) {
    const row = matrix[rowIndex] ?? [];
    const normalized = row.map((cell) => normalizeForMatch(cell));

    if (normalized.some((cell) => cell === "numero de tarea")) {
      const columnByName = new Map<string, number>();
      normalized.forEach((cell, columnIndex) => {
        if (cell) {
          columnByName.set(cell, columnIndex);
        }
      });

      return { headerRowIndex: rowIndex, columnByName };
    }
  }

  throw new Error("Moondesk report header not found (expected a 'Numero de Tarea' column).");
}

function columnGetter(columnByName: Map<string, number>) {
  return (row: unknown[], names: string[]) => {
    for (const name of names) {
      const columnIndex = columnByName.get(normalizeForMatch(name));

      if (columnIndex !== undefined) {
        const value = row[columnIndex];

        if (value !== null && value !== undefined && String(value).trim() !== "") {
          return value;
        }
      }
    }

    return null;
  };
}

function slotFromDocumentType(documentType: string | null, materialType: string | null): ComponentSlot | null {
  const haystack = `${normalizeForMatch(documentType)} ${normalizeForMatch(materialType)}`.trim();

  if (!haystack) {
    return null;
  }

  for (const entry of DOC_TYPE_TO_SLOT) {
    if (entry.match.some((token) => haystack.includes(token))) {
      return entry.slot;
    }
  }

  return null;
}

function isNonPackagingDoc(documentType: string | null) {
  const normalized = normalizeForMatch(documentType);

  return NON_PACKAGING_DOC_TYPES.some((token) => normalized.includes(token));
}

function deriveApprovalState(row: MoondeskTaskRow): MoondeskApprovalState {
  const subtask = normalizeForMatch(row.subtaskStatus);
  const taskStatus = normalizeForMatch(row.taskStatus);

  if (row.changeRequestedBy) {
    return "CHANGES_REQUESTED";
  }

  if ((subtask === "revisado" || taskStatus === "hecho") && row.approvedBy) {
    return "APPROVED";
  }

  if (subtask === "en revision" || taskStatus === "en revision" || row.pendingWith) {
    return "IN_REVIEW";
  }

  return "UNKNOWN";
}

function rowMatchesProject(row: MoondeskTaskRow, projectToken: string, excludeTokens: string[]) {
  const token = normalizeForMatch(projectToken);

  if (!token) {
    return false;
  }

  const haystack = normalizeForMatch(
    [row.taskName, row.product, row.description, row.presentation].filter(Boolean).join(" ")
  );
  const hay = ` ${haystack} `;

  if (!hay.includes(` ${token} `) && !haystack.includes(token)) {
    return false;
  }

  return !excludeTokens.some((exclude) => {
    const normalizedExclude = normalizeForMatch(exclude);

    return normalizedExclude && haystack.includes(normalizedExclude);
  });
}

export function buildMoondeskReport(params: BuildMoondeskReportParams): MoondeskReportResult {
  const { sheetName, matrix } = readMatrix(params.workbookPath, params.sheetName);
  const sourceFileName = params.workbookPath.split("/").pop();
  const { headerRowIndex, columnByName } = locateHeader(matrix);
  const getValue = columnGetter(columnByName);
  const expectedSlots = new Set(params.expectedComponentSlots);
  const excludeTokens = params.excludeProjectTokens ?? [];

  const ignoredByReason: Record<string, number> = {};
  const ignoredSamples: IgnoredMoondeskRow[] = [];
  const candidates: MoondeskTaskCandidate[] = [];
  let rowsParsed = 0;
  let projectRows = 0;

  function ignore(row: MoondeskTaskRow, reason: string) {
    ignoredByReason[reason] = (ignoredByReason[reason] ?? 0) + 1;

    if (ignoredSamples.length < 20) {
      ignoredSamples.push({
        excelRow: row.excelRow,
        reason,
        documentType: row.documentType,
        materialCode: row.materialCode
      });
    }
  }

  for (let rowIndex = headerRowIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
    const rawRow = matrix[rowIndex] ?? [];

    if (rawRow.every((cell) => cell === null || String(cell).trim() === "")) {
      continue;
    }

    const taskNumber = stringOrNull(getValue(rawRow, ["Numero de Tarea"]));

    if (!taskNumber) {
      continue;
    }

    rowsParsed += 1;

    const approvalSerial = getValue(rawRow, ["Fecha de Aprobacion"]);
    const row: MoondeskTaskRow = {
      excelRow: rowIndex + 1,
      taskNumber,
      taskName: stringOrNull(getValue(rawRow, ["Nombre"])),
      taskStatus: stringOrNull(getValue(rawRow, ["Estado"])),
      documentNumber: stringOrNull(getValue(rawRow, ["Numero de Documento"])),
      documentType: stringOrNull(getValue(rawRow, ["Tipo de Documento"])),
      drawingCode: stringOrNull(getValue(rawRow, ["Cod. Plano", "Cod Plano"])),
      description: stringOrNull(getValue(rawRow, ["Descripcion"])),
      presentation: stringOrNull(getValue(rawRow, ["Presentacion"])),
      product: stringOrNull(getValue(rawRow, ["Producto"])),
      materialType: stringOrNull(getValue(rawRow, ["Tipo de material"])),
      materialCode: stringOrNull(getValue(rawRow, ["Cod. Insumo", "Cod Insumo"])),
      subtaskStatus: stringOrNull(getValue(rawRow, ["Estado de la Subtarea"])),
      approvedBy: stringOrNull(getValue(rawRow, ["Aprobado"])),
      changeRequestedBy: stringOrNull(getValue(rawRow, ["Cambio Solicitado"])),
      pendingWith: stringOrNull(getValue(rawRow, ["Pendiente"])),
      approvalDateSerial: typeof approvalSerial === "number" ? approvalSerial : null,
      latestVersion: stringOrNull(getValue(rawRow, ["Ultima Version"]))
    };

    if (!rowMatchesProject(row, params.projectToken, excludeTokens)) {
      ignore(row, "outside_project_context");
      continue;
    }

    projectRows += 1;

    if (!row.materialCode) {
      ignore(row, "no_material_code");
      continue;
    }

    if (isNonPackagingDoc(row.documentType)) {
      ignore(row, `non_packaging_doc:${normalizeForMatch(row.documentType)}`);
      continue;
    }

    const componentSlot = slotFromDocumentType(row.documentType, row.materialType);

    if (!componentSlot) {
      ignore(row, "doc_type_without_slot");
      continue;
    }

    if (!expectedSlots.has(componentSlot)) {
      ignore(row, `slot_not_expected_by_pm:${componentSlot}`);
      continue;
    }

    const approvalState = deriveApprovalState(row);

    candidates.push({
      row,
      componentSlot,
      approvalState,
      approved: approvalState === "APPROVED"
    });
  }

  return {
    candidates,
    diagnostics: {
      sourceFileName,
      sheetName,
      projectToken: params.projectToken,
      rowsParsed,
      projectRows,
      packagingCandidates: candidates.length,
      ignoredRows: rowsParsed - candidates.length,
      ignoredByReason,
      ignoredSamples,
      candidates: candidates.map((candidate) => ({
        excelRow: candidate.row.excelRow,
        componentSlot: candidate.componentSlot,
        materialCode: candidate.row.materialCode,
        documentType: candidate.row.documentType,
        approvalState: candidate.approvalState,
        approved: candidate.approved
      }))
    }
  };
}

// Convierte un serial de fecha de Excel a Date (epoch 1899-12-30).
export function excelSerialToDate(serial: number | null): Date | null {
  if (serial === null || !Number.isFinite(serial)) {
    return null;
  }

  const epoch = Date.UTC(1899, 11, 30);
  const millis = epoch + Math.round(serial * 24 * 60 * 60 * 1000);
  const date = new Date(millis);

  return Number.isNaN(date.getTime()) ? null : date;
}
