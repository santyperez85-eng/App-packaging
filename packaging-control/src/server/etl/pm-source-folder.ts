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

// Un nombre es candidato a PM si menciona la "base de molecula" en cualquiera
// de las variantes vistas ("Planilla base Molécula", "Información base de molecula").
const PM_NAME_HINTS = ["planilla base molecula", "informacion base de molecula", "informacion base molecula"];

// Archivos que viven en las mismas carpetas y no son PM.
const NON_PM_HINTS = ["forecast", "precios", "parametros costeo", "parametro costeo", "costeo", "scoring"];

export type PmWorkbookCandidate = {
  filePath: string;
  fileName: string;
  /** Subcarpeta de producto, o null si el archivo esta en la raiz. */
  productFolder: string | null;
  modifiedAt: Date;
  sizeBytes: number;
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

function classifyFile(fileName: string) {
  // Archivos temporales que Excel deja abiertos.
  if (fileName.startsWith("~$")) {
    return { isCandidate: false, reason: "excel_lock_file" };
  }

  if (path.extname(fileName).toLowerCase() !== ".xlsx") {
    return { isCandidate: false, reason: "not_xlsx" };
  }

  const normalized = normalizeForMatch(path.basename(fileName, path.extname(fileName)));

  if (includesAny(normalized, NON_PM_HINTS)) {
    return { isCandidate: false, reason: "not_pm_by_name" };
  }

  if (!includesAny(normalized, PM_NAME_HINTS)) {
    return { isCandidate: false, reason: "name_does_not_look_like_pm" };
  }

  return { isCandidate: true, reason: "pm_name_match" };
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
        sizeBytes: stats.size
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
    candidates: candidates.sort((left, right) => right.modifiedAt.getTime() - left.modifiedAt.getTime()),
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
