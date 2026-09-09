import fs from "node:fs";
import path from "node:path";

import { normalizeText } from "@/lib/utils";

/**
 * Lectura de la carpeta "DOCUMENTOS APROBADOS" del SharePoint de la compania,
 * donde documentacion tecnica publica los documentos ya aprobados para que
 * Compras pueda usarlos.
 *
 * Estructura real (verificada 2026-09-09):
 *
 *   DOCUMENTOS APROBADOS/
 *     <TIPO DE MATERIAL>/        ESTUCHES, POMOS, FRASCOS, PROSPECTOS, ...
 *       <CODIGO-CON-GUION>/      ED28-70  (el codigo ED28/70; la barra no es
 *                                valida en nombres de carpeta)
 *         archivos .pdf / .ai
 *
 * Los nombres de archivo traen la numeracion `MOONxxxxx` que asigna Moondesk,
 * porque los documentos se descargan de ahi ya nombrados. Eso permite cruzar el
 * documento publicado contra la version que Moondesk reporta como aprobada, y no
 * solo constatar que "hay un archivo".
 *
 * La nomenclatura no es unica; se observaron al menos estas formas:
 *   MOON00393-100X80X100 PYLOBER.pdf
 *   MOON01898.pdf
 *   Especificacion___PL-_ESP-MOON03103__outline.pdf
 *   Plano_ED16__PL-MOON02733_ESP-_.pdf
 *   SE09-70 PYLOBER (Estuche x 120 capsulas) V_prw.pdf
 */

export type ApprovedDocumentKind = "specification" | "drawing" | "artwork" | "unknown";

export type ApprovedDocumentFile = {
  fileName: string;
  kind: ApprovedDocumentKind;
  /** Codigo Moondesk presente en el nombre, si lo hay. */
  moondeskCode: string | null;
  sizeBytes: number;
  modifiedAt: Date;
};

export type ApprovedDocumentEntry = {
  /** Codigo de material reconstruido: la carpeta usa guion donde el codigo usa barra. */
  materialCode: string;
  folderName: string;
  materialTypeFolder: string;
  files: ApprovedDocumentFile[];
  hasSpecification: boolean;
  hasDrawing: boolean;
  hasArtwork: boolean;
  /** Todos los codigos Moondesk hallados, para cruzar contra la tarea aprobada. */
  moondeskCodes: string[];
};

export type ApprovedDocumentsIndex = {
  rootDir: string;
  typeFolders: number;
  materialFolders: number;
  entries: Map<string, ApprovedDocumentEntry>;
  /** Carpetas de codigo que no contienen ningun archivo. */
  emptyFolders: string[];
};

const MOON_CODE = /MOON\d{3,}/i;

function normalizeForMatch(value: string) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * La carpeta usa guion en lugar de la barra del codigo. Solo se convierte el
 * ultimo guion seguido de digitos, que es la version: hay codigos que llevan
 * guiones propios y no deben tocarse.
 */
export function folderNameToMaterialCode(folderName: string) {
  const match = folderName.trim().match(/^(.*)-(\d+)$/);

  return match ? `${match[1]}/${match[2]}` : folderName.trim();
}

export function materialCodeToFolderName(materialCode: string) {
  return materialCode.trim().replace(/\//g, "-");
}

function classifyDocument(fileName: string): ApprovedDocumentKind {
  const normalized = normalizeForMatch(fileName);
  const extension = path.extname(fileName).toLowerCase();

  // El prefijo explicito manda: es el que pone el propio flujo de descarga.
  if (/esp-moon\d+/i.test(fileName) || normalized.startsWith("especificacion")) {
    return "specification";
  }

  if (/pl-moon\d+/i.test(fileName) || normalized.startsWith("plano")) {
    return "drawing";
  }

  // Los artes salen como preview u original editable.
  if (extension === ".ai" || /_prw$|_out$/.test(path.basename(fileName, extension).toLowerCase())) {
    return "artwork";
  }

  return "unknown";
}

function extractMoondeskCode(fileName: string) {
  const match = fileName.match(MOON_CODE);

  return match ? match[0].toUpperCase() : null;
}

export function readApprovedDocuments(rootDir: string): ApprovedDocumentsIndex {
  const resolvedRoot = path.resolve(rootDir);

  if (!fs.existsSync(resolvedRoot)) {
    throw new Error(`Carpeta de documentos aprobados no encontrada: ${resolvedRoot}`);
  }

  const entries = new Map<string, ApprovedDocumentEntry>();
  const emptyFolders: string[] = [];
  let typeFolders = 0;
  let materialFolders = 0;

  for (const typeEntry of fs.readdirSync(resolvedRoot, { withFileTypes: true })) {
    if (!typeEntry.isDirectory()) {
      continue;
    }

    typeFolders += 1;
    const typePath = path.join(resolvedRoot, typeEntry.name);

    for (const codeEntry of fs.readdirSync(typePath, { withFileTypes: true })) {
      if (!codeEntry.isDirectory()) {
        continue;
      }

      materialFolders += 1;
      const codePath = path.join(typePath, codeEntry.name);
      const files: ApprovedDocumentFile[] = [];

      for (const fileEntry of fs.readdirSync(codePath, { withFileTypes: true })) {
        if (!fileEntry.isFile() || fileEntry.name.startsWith("~$") || fileEntry.name.startsWith(".")) {
          continue;
        }

        const stats = fs.statSync(path.join(codePath, fileEntry.name));

        files.push({
          fileName: fileEntry.name,
          kind: classifyDocument(fileEntry.name),
          moondeskCode: extractMoondeskCode(fileEntry.name),
          sizeBytes: stats.size,
          modifiedAt: stats.mtime
        });
      }

      if (!files.length) {
        emptyFolders.push(`${typeEntry.name}/${codeEntry.name}`);
        continue;
      }

      const materialCode = folderNameToMaterialCode(codeEntry.name);
      const key = materialCode.toUpperCase();
      const existing = entries.get(key);
      const merged = existing ? [...existing.files, ...files] : files;

      entries.set(key, {
        materialCode,
        folderName: codeEntry.name,
        materialTypeFolder: existing?.materialTypeFolder ?? typeEntry.name,
        files: merged,
        hasSpecification: merged.some((file) => file.kind === "specification"),
        hasDrawing: merged.some((file) => file.kind === "drawing"),
        hasArtwork: merged.some((file) => file.kind === "artwork"),
        moondeskCodes: [...new Set(merged.map((file) => file.moondeskCode).filter((code): code is string => Boolean(code)))]
      });
    }
  }

  return { rootDir: resolvedRoot, typeFolders, materialFolders, entries, emptyFolders };
}

export function resolveApprovedDocumentsDir(explicitDir?: string) {
  const dir = explicitDir ?? process.env.APPROVED_DOCS_DIR;

  if (!dir) {
    throw new Error(
      "Carpeta de documentos aprobados no configurada. Pasala como argumento o definí APPROVED_DOCS_DIR."
    );
  }

  return path.resolve(dir);
}
