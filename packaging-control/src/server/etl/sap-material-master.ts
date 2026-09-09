import fs from "node:fs";
import * as XLSX from "xlsx";

import { normalizeText, stringOrNull } from "@/lib/utils";

/**
 * Adaptador del corte del maestro de materiales de packaging de SAP.
 *
 * Mientras no exista API, Sistemas entrega un Excel a demanda. El archivo llega
 * plano (una fila por material, headers en la primera fila) con los campos
 * acordados en docs/sap-integration-requirements.md.
 *
 * Semantica confirmada por negocio:
 *  - `ZENV` = "Z envase" (primario: frascos, pomos, aluminios, tapas, bombas).
 *    `ZSEN` = "Z sobre envase" (secundario: estuches, prospectos, etiquetas, cartones).
 *  - Grupo `051` (identico al status `Z3`) = material discontinuado: estuvo en
 *    uso y se dio de baja.
 *  - Marca de borrado = codigo pedido por error, que nunca debio existir. NO es
 *    lo mismo que discontinuado y no debe colapsarse con el anterior.
 */

const DISCONTINUED_GROUP = "051";
const DISCONTINUED_STATUS = "Z3";

/** Largo de los codigos migrados del sistema anterior a SAP, que aceptaba 4 caracteres. */
const LEGACY_CODE_LENGTH = 4;

export type SapMaterialLifecycle = "CURRENT" | "DISCONTINUED" | "ERRONEOUS_CODE";

export type SapMaterialRow = {
  materialCode: string;
  description: string | null;
  materialClass: string | null;
  materialGroup: string | null;
  deletionFlag: boolean;
  statusCode: string | null;
  baseUom: string | null;
  createdAt: Date | null;
  lastModifiedAt: Date | null;
  /** Estado operativo derivado. Ver semantica arriba. */
  lifecycle: SapMaterialLifecycle;
  /** Raiz del codigo, sin la version. */
  rootCode: string;
  /** Version del codigo. Ver notas de versionado abajo. */
  versionLabel: string | null;
  /** De donde se leyo la version: del codigo, de la descripcion (legacy) o ninguna. */
  versionSource: "code" | "legacy_description" | "none";
};

export type SapMasterParseResult = {
  sourceFileName: string;
  /** Maximo de ultima modificacion: fecha de los datos del corte. */
  dataDate: Date | null;
  /** mtime del archivo: cuando se recibio. */
  receivedAt: Date | null;
  rows: SapMaterialRow[];
  diagnostics: {
    totalRows: number;
    current: number;
    discontinued: number;
    erroneousCode: number;
    byClass: Record<string, number>;
    withoutGroup: number;
    duplicates: string[];
    versionFromCode: number;
    versionFromLegacyDescription: number;
    withoutVersion: number;
  };
};

function normalizeHeader(value: unknown) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function excelSerialToDate(value: unknown): Date | null {
  const serial = typeof value === "number" ? value : Number(String(value ?? "").trim());

  if (!Number.isFinite(serial) || serial <= 0) {
    return null;
  }

  const date = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);

  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * La version normalmente es el sufijo `/NN` del codigo. Los codigos migrados del
 * sistema anterior (exactamente 4 caracteres) no pudieron llevarla en el codigo y
 * quedo escrita en la descripcion; ahi se la busca solo para esos.
 * Un material sin version en ningun lado no necesariamente es un error: la version
 * esta asociada a que el material lleve impresion.
 */
function extractVersion(materialCode: string, description: string | null) {
  const codeMatch = materialCode.match(/^(.*?)\/(\d+)$/);

  if (codeMatch) {
    return { rootCode: codeMatch[1], versionLabel: codeMatch[2], versionSource: "code" as const };
  }

  if (materialCode.length === LEGACY_CODE_LENGTH && description) {
    const legacyMatch = description.match(/\/(\d{2})\b/);

    if (legacyMatch) {
      return { rootCode: materialCode, versionLabel: legacyMatch[1], versionSource: "legacy_description" as const };
    }
  }

  return { rootCode: materialCode, versionLabel: null, versionSource: "none" as const };
}

function deriveLifecycle(params: {
  materialGroup: string | null;
  statusCode: string | null;
  deletionFlag: boolean;
}): SapMaterialLifecycle {
  // El codigo erroneo se evalua primero: no llego a estar en uso, asi que no
  // tiene sentido reportarlo como discontinuado aunque comparta señales.
  if (params.deletionFlag) {
    return "ERRONEOUS_CODE";
  }

  if (params.materialGroup === DISCONTINUED_GROUP || params.statusCode === DISCONTINUED_STATUS) {
    return "DISCONTINUED";
  }

  return "CURRENT";
}

export function parseSapMaterialMaster(workbookPath: string, sheetName?: string): SapMasterParseResult {
  if (!fs.existsSync(workbookPath)) {
    throw new Error(`SAP master workbook not found: ${workbookPath}`);
  }

  const workbook = XLSX.readFile(workbookPath);
  const resolvedSheet = sheetName ?? workbook.SheetNames[0];
  const worksheet = workbook.Sheets[resolvedSheet];

  if (!worksheet) {
    throw new Error(`SAP master sheet not found: ${resolvedSheet}`);
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: null, raw: true });

  if (!matrix.length) {
    throw new Error("SAP master sheet is empty");
  }

  const headers = (matrix[0] ?? []).map((cell) => normalizeHeader(cell));
  const columnOf = (...candidates: string[]) => {
    for (const candidate of candidates) {
      const index = headers.findIndex((header) => header === normalizeHeader(candidate) || header.startsWith(normalizeHeader(candidate)));

      if (index >= 0) {
        return index;
      }
    }

    return -1;
  };

  const cols = {
    material: columnOf("Material"),
    description: columnOf("Descripcion"),
    materialClass: columnOf("Tipo Material"),
    materialGroup: columnOf("Grupo Articulo"),
    deletion: columnOf("Marca borrado"),
    status: columnOf("Status material"),
    uom: columnOf("UMB"),
    created: columnOf("Fecha creacion"),
    modified: columnOf("Ultima modificacion")
  };

  if (cols.material < 0) {
    throw new Error("SAP master sheet has no 'Material' column");
  }

  const rows: SapMaterialRow[] = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const byClass: Record<string, number> = {};
  let withoutGroup = 0;
  let latestModified: Date | null = null;
  let versionFromCode = 0;
  let versionFromLegacyDescription = 0;
  let withoutVersion = 0;

  const readCell = (row: unknown[], index: number) => (index >= 0 ? row[index] : null);

  for (let rowIndex = 1; rowIndex < matrix.length; rowIndex += 1) {
    const raw = matrix[rowIndex] ?? [];
    const materialCode = stringOrNull(readCell(raw, cols.material));

    if (!materialCode) {
      continue;
    }

    if (seen.has(materialCode.toUpperCase())) {
      duplicates.push(materialCode);
      continue;
    }

    seen.add(materialCode.toUpperCase());

    const description = stringOrNull(readCell(raw, cols.description));
    const materialClass = stringOrNull(readCell(raw, cols.materialClass));
    const materialGroup = stringOrNull(readCell(raw, cols.materialGroup));
    const statusCode = stringOrNull(readCell(raw, cols.status));
    const deletionFlag = Boolean(stringOrNull(readCell(raw, cols.deletion)));
    const lastModifiedAt = excelSerialToDate(readCell(raw, cols.modified));
    const version = extractVersion(materialCode, description);

    if (version.versionSource === "code") versionFromCode += 1;
    else if (version.versionSource === "legacy_description") versionFromLegacyDescription += 1;
    else withoutVersion += 1;

    if (materialClass) {
      byClass[materialClass] = (byClass[materialClass] ?? 0) + 1;
    }

    if (!materialGroup) {
      withoutGroup += 1;
    }

    if (lastModifiedAt && (!latestModified || lastModifiedAt > latestModified)) {
      latestModified = lastModifiedAt;
    }

    rows.push({
      materialCode,
      description,
      materialClass,
      materialGroup,
      deletionFlag,
      statusCode,
      baseUom: stringOrNull(readCell(raw, cols.uom)),
      createdAt: excelSerialToDate(readCell(raw, cols.created)),
      lastModifiedAt,
      lifecycle: deriveLifecycle({ materialGroup, statusCode, deletionFlag }),
      ...version
    });
  }

  const counts = rows.reduce(
    (acc, row) => {
      if (row.lifecycle === "CURRENT") acc.current += 1;
      else if (row.lifecycle === "DISCONTINUED") acc.discontinued += 1;
      else acc.erroneousCode += 1;

      return acc;
    },
    { current: 0, discontinued: 0, erroneousCode: 0 }
  );

  return {
    sourceFileName: workbookPath.split("/").pop() ?? workbookPath,
    dataDate: latestModified,
    receivedAt: fs.statSync(workbookPath).mtime,
    rows,
    diagnostics: {
      totalRows: rows.length,
      ...counts,
      byClass,
      withoutGroup,
      duplicates,
      versionFromCode,
      versionFromLegacyDescription,
      withoutVersion
    }
  };
}

/** ZENV = envase primario, ZSEN = sobre envase (secundario). */
export function materialClassToPackagingLevel(materialClass: string | null): "PRIMARY" | "SECONDARY" | null {
  const normalized = (materialClass ?? "").trim().toUpperCase();

  if (normalized === "ZENV") return "PRIMARY";
  if (normalized === "ZSEN") return "SECONDARY";

  return null;
}
