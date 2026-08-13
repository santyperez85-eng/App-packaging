import * as XLSX from "xlsx";

import { normalizeText, stringOrNull } from "@/lib/utils";
import { excelSerialToDate } from "@/server/etl/moondesk-tasks-report";

type SheetMatrix = Array<Array<unknown>>;

/**
 * Adaptadores para los reportes de tiempos de Moondesk (export Excel):
 *  - Tasks_Times: una fila por tarea, con subtareas, reprocesos y matriz de dias
 *    por usuario en Diseno / Revision / Cierre.
 *  - Users_Tasks_Times: una fila por paso de un usuario en una tarea (rol, estado,
 *    dias habiles, inicio, fin).
 * Ambos se agrupan por Numero de Tarea; no vinculan a items por si mismos, solo
 * enriquecen las MoondeskTask ya creadas desde el reporte Tasks.
 */

function normalizeForMatch(value: unknown) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function readMatrix(workbookPath: string, sheetName?: string): SheetMatrix {
  const workbook = XLSX.readFile(workbookPath);
  const resolved = sheetName ?? workbook.SheetNames[0];
  const worksheet = workbook.Sheets[resolved];

  if (!worksheet) {
    throw new Error(`Moondesk times sheet not found: ${resolved}`);
  }

  return XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: null, raw: true });
}

function locateHeaderRow(matrix: SheetMatrix) {
  for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 40); rowIndex += 1) {
    const normalized = (matrix[rowIndex] ?? []).map((cell) => normalizeForMatch(cell));

    if (normalized.some((cell) => cell === "numero de tarea")) {
      return rowIndex;
    }
  }

  throw new Error("Moondesk times report header not found (expected 'Numero de Tarea').");
}

function numericOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(String(value).replace(",", "."));

  return Number.isFinite(parsed) ? parsed : null;
}

export type MoondeskTaskTiming = {
  taskNumber: string;
  taskName: string | null;
  status: string | null;
  subtaskCount: number | null;
  reprocessCount: number | null;
  designDays: number | null;
  reviewDays: number | null;
  closeDays: number | null;
};

// Suma una banda de columnas (una seccion de tiempos) para una fila.
function sumBand(row: unknown[], startCol: number, endCol: number): number | null {
  let total = 0;
  let hasValue = false;

  for (let col = startCol; col <= endCol && col < row.length; col += 1) {
    const value = numericOrNull(row[col]);

    if (value !== null) {
      total += value;
      hasValue = true;
    }
  }

  return hasValue ? total : null;
}

export function parseTasksTimes(workbookPath: string, sheetName?: string): Map<string, MoondeskTaskTiming> {
  const matrix = readMatrix(workbookPath, sheetName);
  const headerRowIndex = locateHeaderRow(matrix);
  // La fila inmediatamente superior marca las bandas de secciones.
  const bandRow = (matrix[headerRowIndex - 1] ?? []).map((cell) => normalizeForMatch(cell));
  const headerRow = (matrix[headerRowIndex] ?? []).map((cell) => normalizeForMatch(cell));

  const designStart = bandRow.findIndex((cell) => cell.includes("tiempos de diseno"));
  const reviewStart = bandRow.findIndex((cell) => cell.includes("tiempos de revision"));
  const closeStart = bandRow.findIndex((cell) => cell.includes("tiempos de cierre"));
  const lastColumn = Math.max(
    ...matrix.map((row) => (row ? row.length : 0)),
    headerRow.length
  ) - 1;

  const designRange: [number, number] | null =
    designStart >= 0 ? [designStart, (reviewStart >= 0 ? reviewStart : lastColumn + 1) - 1] : null;
  const reviewRange: [number, number] | null =
    reviewStart >= 0 ? [reviewStart, (closeStart >= 0 ? closeStart : lastColumn + 1) - 1] : null;
  const closeRange: [number, number] | null = closeStart >= 0 ? [closeStart, lastColumn] : null;

  const columnOf = (name: string) => headerRow.findIndex((cell) => cell === normalizeForMatch(name));
  const taskCol = columnOf("numero de tarea");
  const nameCol = columnOf("nombre");
  const statusCol = columnOf("estado");
  const subtaskCol = columnOf("subtareas");
  const reprocessCol = columnOf("reprocesos");

  const byTask = new Map<string, MoondeskTaskTiming>();

  for (let rowIndex = headerRowIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex] ?? [];
    const taskNumber = stringOrNull(taskCol >= 0 ? row[taskCol] : null);

    if (!taskNumber) {
      continue;
    }

    byTask.set(taskNumber, {
      taskNumber,
      taskName: stringOrNull(nameCol >= 0 ? row[nameCol] : null),
      status: stringOrNull(statusCol >= 0 ? row[statusCol] : null),
      subtaskCount: subtaskCol >= 0 ? numericOrNull(row[subtaskCol]) : null,
      reprocessCount: reprocessCol >= 0 ? numericOrNull(row[reprocessCol]) : null,
      designDays: designRange ? sumBand(row, designRange[0], designRange[1]) : null,
      reviewDays: reviewRange ? sumBand(row, reviewRange[0], reviewRange[1]) : null,
      closeDays: closeRange ? sumBand(row, closeRange[0], closeRange[1]) : null
    });
  }

  return byTask;
}

export type MoondeskUserStep = {
  taskNumber: string;
  taskName: string | null;
  user: string | null;
  role: string | null;
  status: string | null;
  workingDays: number | null;
  documents: number | null;
  startedAt: Date | null;
  endedAt: Date | null;
  stepIndex: number;
};

export function parseUsersTasksTimes(workbookPath: string, sheetName?: string): Map<string, MoondeskUserStep[]> {
  const matrix = readMatrix(workbookPath, sheetName);
  const headerRowIndex = locateHeaderRow(matrix);
  const headerRow = (matrix[headerRowIndex] ?? []).map((cell) => normalizeForMatch(cell));
  const columnOf = (name: string) => headerRow.findIndex((cell) => cell === normalizeForMatch(name));

  const taskCol = columnOf("numero de tarea");
  const nameCol = columnOf("nombre");
  const userCol = columnOf("usuario");
  const roleCol = columnOf("rol");
  const statusCol = columnOf("estado");
  const daysCol = columnOf("dias habiles");
  const docsCol = columnOf("documentos");
  const startCol = columnOf("inicio");
  const endCol = columnOf("fin");

  const byTask = new Map<string, MoondeskUserStep[]>();
  const perTaskCounter = new Map<string, number>();

  for (let rowIndex = headerRowIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex] ?? [];
    const taskNumber = stringOrNull(taskCol >= 0 ? row[taskCol] : null);

    if (!taskNumber) {
      continue;
    }

    const stepIndex = (perTaskCounter.get(taskNumber) ?? 0) + 1;
    perTaskCounter.set(taskNumber, stepIndex);

    const step: MoondeskUserStep = {
      taskNumber,
      taskName: stringOrNull(nameCol >= 0 ? row[nameCol] : null),
      user: stringOrNull(userCol >= 0 ? row[userCol] : null),
      role: stringOrNull(roleCol >= 0 ? row[roleCol] : null),
      status: stringOrNull(statusCol >= 0 ? row[statusCol] : null),
      workingDays: daysCol >= 0 ? numericOrNull(row[daysCol]) : null,
      documents: docsCol >= 0 ? numericOrNull(row[docsCol]) : null,
      startedAt: startCol >= 0 ? excelSerialToDate(numericOrNull(row[startCol])) : null,
      endedAt: endCol >= 0 ? excelSerialToDate(numericOrNull(row[endCol])) : null,
      stepIndex
    };

    const existing = byTask.get(taskNumber);

    if (existing) {
      existing.push(step);
    } else {
      byTask.set(taskNumber, [step]);
    }
  }

  return byTask;
}

export function isReviewerRole(role: string | null) {
  return normalizeForMatch(role) === "revisor";
}
