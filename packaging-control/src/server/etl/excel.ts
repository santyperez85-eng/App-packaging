import * as XLSX from "xlsx";

import { createBatchId } from "@/lib/utils";

type RawRow = Record<string, unknown>;

export function normalizeRow(row: RawRow) {
  const normalized: RawRow = {};

  for (const [key, value] of Object.entries(row)) {
    normalized[String(key).trim().toLowerCase()] = value;
  }

  return normalized;
}

export function getRowValue(row: RawRow, candidates: string[]) {
  const normalized = normalizeRow(row);

  for (const candidate of candidates) {
    const value = normalized[candidate.toLowerCase()];

    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return null;
}

export async function readRowsFromRequest(request: Request): Promise<{
  batchId: string;
  sourceFileName?: string;
  sheets: Array<{ sheetName: string; rows: RawRow[] }>;
}> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = (await request.json()) as {
      batchId?: string;
      rows?: RawRow[];
      sourceFileName?: string;
      sheetName?: string;
    };

    return {
      batchId: body.batchId ?? createBatchId("json"),
      sourceFileName: body.sourceFileName,
      sheets: [
        {
          sheetName: body.sheetName ?? "Sheet1",
          rows: body.rows ?? []
        }
      ]
    };
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw new Error("A file or JSON payload is required.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });

  return {
    batchId: createBatchId("xlsx"),
    sourceFileName: file.name,
    sheets: workbook.SheetNames.map((sheetName) => ({
      sheetName,
      rows: XLSX.utils.sheet_to_json<RawRow>(workbook.Sheets[sheetName], {
        defval: null,
        raw: false
      })
    }))
  };
}
