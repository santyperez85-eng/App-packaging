import fs from "node:fs";
import path from "node:path";

import { normalizeText } from "@/lib/utils";

/**
 * Descubrimiento de planillas PM en una carpeta local (tipicamente la carpeta
 * compartida de OneDrive sincronizada: "Información Base Moléculas").
 *
 * Estructura real observada: una subcarpeta por producto, con la planilla PM
 * junto a planos PDF, POS y otros xlsx que NO son PM. Los nombres de archivo no
 * siguen una sola convencion, y una carpeta puede tener:
 *  - un solo PM (VALSARTAN)
 *  - varios PM que son productos distintos (PARAZETA 1 gr y 500 mg)
 *  - varios PM que son versiones del mismo (AMIXEN v1, v2)
 * Por eso el matcher es flexible y el desempate entre versiones se resuelve mas
 * tarde, con el projectCode que sale del contenido de la planilla.
 */

/**
 * El nombre NO alcanza para decidir si un xlsx es PM: en la carpeta real
 * convive `Perpiel Heridas Spray - Planilla base Molécula.xlsx` con
 * `Creatina en Polvo.xlsx`, `Magnesio en Polvo 150gr.xlsx` o
 * `Planilla Base Geles de Niños.xlsx`, todos PM validos. Por eso el nombre se
 * usa solo para descartar ruido evidente y la inclusion la decide el contenido
 * (el selector de hoja PM exige producto, presentacion y estructura real).
 */
const NON_PM_HINTS = [
  "forecast",
  "precios",
  "parametros costeo",
  "parametro costeo",
  "costeo",
  "costo estimado",
  "scoring",
  "no usar",
  "venta y mm"
];

// Señal de que el nombre sigue una de las convenciones canonicas. No filtra:
// sirve como diagnostico y para priorizar en el desempate.
const CANONICAL_NAME_HINTS = [
  "planilla base molecula",
  "planilla base",
  "informacion base de molecula",
  "informacion base molecula"
];

export type PmWorkbookCandidate = {
  filePath: string;
  fileName: string;
  /** Subcarpeta de producto, o null si el archivo esta en la raiz. */
  productFolder: string | null;
  modifiedAt: Date;
  sizeBytes: number;
  /** El nombre sigue una convencion conocida de PM. Solo informativo. */
  nameLooksCanonical: boolean;
};

export type PmSourceDiscovery = {
  rootDir: string;
  foldersScanned: number;
  filesScanned: number;
  candidates: PmWorkbookCandidate[];
  ignored: Array<{ fileName: string; productFolder: string | null; reason: string }>;
};

function normalizeForMatch(value: string) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function includesAny(haystack: string, needles: string[]) {
  return needles.some((needle) => haystack.includes(needle));
}

function classifyFile(fileName: string): { isCandidate: boolean; reason: string; nameLooksCanonical: boolean } {
  // Archivos temporales que Excel deja abiertos.
  if (fileName.startsWith("~$")) {
    return { isCandidate: false, reason: "excel_lock_file", nameLooksCanonical: false };
  }

  if (path.extname(fileName).toLowerCase() !== ".xlsx") {
    return { isCandidate: false, reason: "not_xlsx", nameLooksCanonical: false };
  }

  const normalized = normalizeForMatch(path.basename(fileName, path.extname(fileName)));

  if (includesAny(normalized, NON_PM_HINTS)) {
    return { isCandidate: false, reason: "not_pm_by_name", nameLooksCanonical: false };
  }

  return {
    isCandidate: true,
    reason: "candidate_pending_content_check",
    nameLooksCanonical: includesAny(normalized, CANONICAL_NAME_HINTS)
  };
}

export function discoverPmWorkbooks(rootDir: string): PmSourceDiscovery {
  const resolvedRoot = path.resolve(rootDir);

  if (!fs.existsSync(resolvedRoot)) {
    throw new Error(`PM source folder not found: ${resolvedRoot}`);
  }

  const candidates: PmWorkbookCandidate[] = [];
  const ignored: PmSourceDiscovery["ignored"] = [];
  let foldersScanned = 0;
  let filesScanned = 0;

  function scanDirectory(directory: string, productFolder: string | null) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        // Un nivel de subcarpetas: la carpeta de producto.
        if (productFolder === null) {
          foldersScanned += 1;
          scanDirectory(entryPath, entry.name);
        }

        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      filesScanned += 1;
      const classification = classifyFile(entry.name);

      if (!classification.isCandidate) {
        // Solo se reportan los xlsx descartados; los PDF/DOCX son ruido esperado.
        if (classification.reason !== "not_xlsx") {
          ignored.push({ fileName: entry.name, productFolder, reason: classification.reason });
        }

        continue;
      }

      const stats = fs.statSync(entryPath);

      candidates.push({
        filePath: entryPath,
        fileName: entry.name,
        productFolder,
        modifiedAt: stats.mtime,
        sizeBytes: stats.size,
        nameLooksCanonical: classification.nameLooksCanonical
      });
    }
  }

  scanDirectory(resolvedRoot, null);

  return {
    rootDir: resolvedRoot,
    foldersScanned,
    filesScanned,
    // Mas reciente primero: si dos archivos resultan ser el mismo proyecto,
    // el primero en procesarse gana y los siguientes quedan como version anterior.
    // A igual fecha desempata el nombre canonico, que es la fuente mas confiable.
    candidates: candidates.sort((left, right) => {
      const byDate = right.modifiedAt.getTime() - left.modifiedAt.getTime();

      if (byDate !== 0) {
        return byDate;
      }

      return Number(right.nameLooksCanonical) - Number(left.nameLooksCanonical);
    }),
    ignored
  };
}

export function resolvePmSourceDir(explicitDir?: string) {
  const dir = explicitDir ?? process.env.PM_SOURCE_DIR;

  if (!dir) {
    throw new Error(
      "PM source folder not configured. Pass it explicitly or set PM_SOURCE_DIR (e.g. the synced OneDrive path)."
    );
  }

  return path.resolve(dir);
}
