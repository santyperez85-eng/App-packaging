import * as XLSX from "xlsx";

import { createBatchId } from "@/lib/utils";

type RawRow = Record<string, unknown>;
type SheetMatrix = Array<Array<unknown>>;
type PmSheetCandidate = {
  sheetName: string;
  row: RawRow;
  productName: string | null;
  presentation: string | null;
  activeIngredient: string | null;
  filledFields: string[];
  structuralSignals: string[];
  excludedByName: boolean;
  excludedByStructure: boolean;
  isValid: boolean;
  score: number;
};

const EXCLUDED_PM_SHEET_NAME_TERMS = ["forecast", "resumen", "base", "compras", "aarr", "produccion"];

const PM_OPERATIONAL_STRUCTURE_SIGNALS = [
  {
    key: "presentaciones_originales",
    terms: ["presentaciones de originales"]
  },
  {
    key: "presentaciones_muestras",
    terms: ["presentaciones de muestras medicas", "presentaciones de muestras medicas"]
  },
  {
    key: "envase_primario",
    terms: ["tipo de envase primario", "otro tipo de envasado primario", "frasco pet"]
  },
  {
    key: "envase_secundario",
    terms: ["envase secundario", "estuche", "prospecto/info paciente", "folleto explicativo"]
  },
  {
    key: "packaging_toggle",
    terms: ["blister", "porta blister", "calendario", "prospecto/info paciente", "frasco pet"]
  }
] as const;

const PM_AUXILIARY_STRUCTURE_TERMS = ["art sap", "linea", "categoria", "mar 27", "apr 27", "may 27", "originales"];

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

function normalizeLabel(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isEmptyCell(value: unknown) {
  return value === null || value === undefined || String(value).trim() === "";
}

function findFixedField(rows: SheetMatrix, labels: string[]) {
  const normalizedLabels = labels.map((label) => normalizeLabel(label));

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];

    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const value = row[columnIndex];

      if (!normalizedLabels.includes(normalizeLabel(value))) {
        continue;
      }

      for (
        let nextColumnIndex = columnIndex + 1;
        nextColumnIndex < row.length && nextColumnIndex <= columnIndex + 2;
        nextColumnIndex += 1
      ) {
        const candidate = row[nextColumnIndex];

        if (!isEmptyCell(candidate)) {
          return String(candidate).trim();
        }
      }

      return null;
    }
  }

  return null;
}

function inferPmTemplateType(sheetName: string) {
  const normalized = normalizeLabel(sheetName);

  if (normalized.includes("venta libre") && normalized.includes("farma")) {
    return "VENTA_LIBRE_FARMA";
  }

  if (normalized.includes("medicinal")) {
    return "MEDICINAL";
  }

  if (normalized.includes("crema")) {
    return "CREMAS";
  }

  if (normalized.includes("otc")) {
    return "OTC";
  }

  return normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase() || "UNKNOWN";
}

function compactSheetRows(rows: SheetMatrix) {
  return rows.map((row) => row.map((cell) => (cell === undefined ? null : cell)));
}

function stringOrNull(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized === "" ? null : normalized;
}

function getRawObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RawRow) : {};
}

function getPmRawRows(row: RawRow) {
  const rawData = getRawObject(row.rawData);

  return Array.isArray(rawData.rows) ? (rawData.rows as SheetMatrix) : [];
}

function normalizeMatrixText(rows: SheetMatrix) {
  return rows
    .flatMap((row) => row.map((cell) => normalizeLabel(cell)))
    .filter(Boolean)
    .join(" | ");
}

function detectOperationalPmSignals(rows: SheetMatrix) {
  const matrixText = normalizeMatrixText(rows);

  return PM_OPERATIONAL_STRUCTURE_SIGNALS.filter(({ terms }) =>
    terms.some((term) => matrixText.includes(normalizeLabel(term)))
  ).map(({ key }) => key);
}

function isExcludedPmSheetName(sheetName: string) {
  const normalized = normalizeLabel(sheetName);

  return EXCLUDED_PM_SHEET_NAME_TERMS.some((term) => normalized.includes(term));
}

function hasAuxiliarySheetStructure(rows: SheetMatrix) {
  const matrixText = normalizeMatrixText(rows);

  return PM_AUXILIARY_STRUCTURE_TERMS.some((term) => matrixText.includes(normalizeLabel(term)));
}

function sheetRowsToPmStagingRow(params: {
  sourceWorkbook?: string;
  sheetName: string;
  rows: SheetMatrix;
}) {
  const templateType = inferPmTemplateType(params.sheetName);
  const producto = findFixedField(params.rows, ["Producto"]);
  const presentacion = findFixedField(params.rows, ["Presentación", "Presentacion"]);
  const drogaActiva = findFixedField(params.rows, ["Droga Activa", "Droga"]);
  const rawRows = compactSheetRows(params.rows);

  return {
    sourceWorkbook: params.sourceWorkbook,
    sheetName: params.sheetName,
    templateType,
    producto,
    productName: producto,
    presentacion,
    presentation: presentacion,
    drogaActiva,
    activeIngredient: drogaActiva,
    rawData: {
      sourceWorkbook: params.sourceWorkbook,
      sheetName: params.sheetName,
      templateType,
      producto,
      presentacion,
      drogaActiva,
      rows: rawRows
    }
  } satisfies RawRow;
}

function getPmCandidateValue(row: RawRow, candidates: string[]) {
  return stringOrNull(getRowValue(row, candidates));
}

function createPmSheetCandidate(sheetName: string, row: RawRow): PmSheetCandidate {
  const productName = getPmCandidateValue(row, ["productName", "product_name", "producto", "nombre producto"]);
  const presentation = getPmCandidateValue(row, ["presentation", "presentacion"]);
  const activeIngredient = getPmCandidateValue(row, [
    "activeIngredient",
    "active_ingredient",
    "drogaActiva",
    "droga_activa",
    "droga activa"
  ]);
  const filledFields = [
    productName ? "Producto" : null,
    presentation ? "Presentacion" : null,
    activeIngredient ? "Droga Activa" : null
  ].filter((field): field is string => Boolean(field));
  const pmRows = getPmRawRows(row);
  const structuralSignals = detectOperationalPmSignals(pmRows);
  const excludedByName = isExcludedPmSheetName(sheetName);
  const excludedByStructure = structuralSignals.length === 0 && hasAuxiliarySheetStructure(pmRows);
  const hasOperationalStructure = structuralSignals.length > 0;

  return {
    sheetName,
    row,
    productName,
    presentation,
    activeIngredient,
    filledFields,
    structuralSignals,
    excludedByName,
    excludedByStructure,
    isValid: Boolean(productName && presentation && hasOperationalStructure && !excludedByName && !excludedByStructure),
    score:
      (productName ? 4 : 0) +
      (presentation ? 3 : 0) +
      (activeIngredient ? 2 : 0) +
      structuralSignals.length * 3 -
      (excludedByName ? 10 : 0) -
      (excludedByStructure ? 6 : 0)
  };
}

function formatPmCandidate(candidate: PmSheetCandidate) {
  const fields = candidate.filledFields.length ? candidate.filledFields.join(", ") : "sin campos de identidad";
  const signals = candidate.structuralSignals.length
    ? `; señales=${candidate.structuralSignals.join(", ")}`
    : "; sin señales estructurales PM";

  return `${candidate.sheetName} (${fields}${signals})`;
}

function withPmSheetDetection(row: RawRow, detection: RawRow) {
  const rawData = row.rawData && typeof row.rawData === "object" && !Array.isArray(row.rawData) ? row.rawData : {};

  return {
    ...row,
    rawData: {
      ...rawData,
      pmSheetDetection: detection
    }
  } satisfies RawRow;
}

function selectRelevantPmSheet(sheets: Array<{ sheetName: string; rows: RawRow[] }>) {
  const candidates = sheets.map((sheet) => {
    const row = sheet.rows[0] ?? {};

    return createPmSheetCandidate(sheet.sheetName, row);
  });
  const validCandidates = candidates.filter((candidate) => candidate.isValid);
  const detection = {
    rule: "valid_sheet_requires_non_empty_producto_presentacion_and_operational_pm_structure",
    note:
      "A valid PM sheet must have Producto and Presentacion with real values, plus at least one operational PM structure signal. Auxiliary tabs such as forecast/resumen/base/compras/aarr/produccion are excluded.",
    candidates: candidates.map((candidate) => ({
      sheetName: candidate.sheetName,
      productName: candidate.productName,
      presentation: candidate.presentation,
      activeIngredient: candidate.activeIngredient,
      filledFields: candidate.filledFields,
      structuralSignals: candidate.structuralSignals,
      excludedByName: candidate.excludedByName,
      excludedByStructure: candidate.excludedByStructure,
      isValid: candidate.isValid,
      score: candidate.score
    }))
  } satisfies RawRow;

  if (validCandidates.length === 0) {
    throw new Error(
      `No valid PM sheet found. A valid PM sheet must have non-empty Producto and Presentacion plus operational PM structure. Checked: ${candidates
        .map(formatPmCandidate)
        .join("; ")}.`
    );
  }

  if (validCandidates.length > 1) {
    throw new Error(
      `Ambiguous PM workbook: multiple valid sheets found. Keep only one filled PM sheet or split the workbook. Valid sheets: ${validCandidates
        .map(formatPmCandidate)
        .join("; ")}.`
    );
  }

  const selectedCandidate = validCandidates[0];

  return {
    sheetName: selectedCandidate.sheetName,
    rows: [
      withPmSheetDetection(selectedCandidate.row, {
        ...detection,
        selectedSheetName: selectedCandidate.sheetName,
        ignoredSheetNames: candidates
          .filter((candidate) => candidate.sheetName !== selectedCandidate.sheetName)
          .map((candidate) => candidate.sheetName)
      })
    ]
  };
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

export async function readPmSheetsFromRequest(request: Request): Promise<{
  batchId: string;
  sourceFileName?: string;
  sheets: Array<{ sheetName: string; rows: RawRow[] }>;
}> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = (await request.json()) as {
      batchId?: string;
      sourceFileName?: string;
      sheets?: Array<{ sheetName?: string; rows?: SheetMatrix; rawData?: RawRow }>;
      rows?: RawRow[];
      sheetName?: string;
    };

    if (body.sheets?.length) {
      const sheets = body.sheets.map((sheet, index) => {
        const sheetName = sheet.sheetName ?? `Sheet${index + 1}`;
        const stagingRow = sheet.rawData
          ? {
              ...sheet.rawData,
              sourceWorkbook: body.sourceFileName,
              sheetName,
              templateType: sheet.rawData.templateType ?? inferPmTemplateType(sheetName)
            }
          : sheetRowsToPmStagingRow({
              sourceWorkbook: body.sourceFileName,
              sheetName,
              rows: sheet.rows ?? []
            });

        return {
          sheetName,
          rows: [stagingRow]
        };
      });

      return {
        batchId: body.batchId ?? createBatchId("json-pm"),
        sourceFileName: body.sourceFileName,
        sheets: [selectRelevantPmSheet(sheets)]
      };
    }

    return {
      batchId: body.batchId ?? createBatchId("json-pm"),
      sourceFileName: body.sourceFileName,
      sheets: [
        {
          sheetName: body.sheetName ?? "Sheet1",
          rows: body.rows?.length
            ? body.rows
            : [
                sheetRowsToPmStagingRow({
                  sourceWorkbook: body.sourceFileName,
                  sheetName: body.sheetName ?? "Sheet1",
                  rows: []
                })
              ]
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
  const sheets = workbook.SheetNames.map((sheetName) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      defval: null,
      raw: false,
      blankrows: false
    });

    return {
      sheetName,
      rows: [
        sheetRowsToPmStagingRow({
          sourceWorkbook: file.name,
          sheetName,
          rows
        })
      ]
    };
  });

  return {
    batchId: createBatchId("pm-xlsx"),
    sourceFileName: file.name,
    sheets: [selectRelevantPmSheet(sheets)]
  };
}
