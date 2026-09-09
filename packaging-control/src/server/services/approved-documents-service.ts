import { prisma } from "@/lib/prisma";
import {
  readApprovedDocuments,
  resolveApprovedDocumentsDir,
  type ApprovedDocumentKind
} from "@/server/etl/approved-documents-folder";
import { parseMoondeskTaskTypesByCode } from "@/server/etl/moondesk-tasks-report";

/**
 * Escanea la carpeta DOCUMENTOS APROBADOS y persiste, por codigo de material,
 * que documentos hay publicados.
 *
 * Muchos archivos no dicen en el nombre si son plano, especificacion o arte:
 * se llaman solo `MOON01898.pdf`. La clasificacion sale entonces de cruzar ese
 * codigo contra el "Tipo de Documento" que reporta Moondesk, que es de donde se
 * descargaron ya nombrados. Es tambien lo que permite verificar que el archivo
 * publicado corresponde a la version que Moondesk aprobo, y no solo que existe
 * un archivo.
 */

/** Tipos de Moondesk que corresponden a un plano o a una especificacion. */
function kindFromMoondeskType(sourceType: string): ApprovedDocumentKind {
  const normalized = sourceType.trim().toLowerCase();

  if (normalized.startsWith("plano")) {
    return "drawing";
  }

  if (normalized.startsWith("especificac") || normalized === "ft") {
    return "specification";
  }

  // El resto de los tipos que reporta Moondesk son componentes (Estuche,
  // Etiqueta, Prospecto, Aluminio, Frasco...): el documento es su arte.
  return "artwork";
}

export type ApprovedDocumentsScanResult = {
  rootDir: string;
  typeFolders: number;
  materialFolders: number;
  materialsWithFiles: number;
  emptyFolders: number;
  totalFiles: number;
  classifiedByName: number;
  classifiedByMoondesk: number;
  stillUnclassified: number;
  withSpecification: number;
  withDrawing: number;
  withArtwork: number;
  moondeskCodesIndexed: number;
};

export const approvedDocumentsService = {
  async scanAndPersist(params?: {
    rootDir?: string;
    /** Reporte de tareas de Moondesk, para clasificar los archivos por su codigo MOON. */
    moondeskTasksWorkbookPath?: string;
  }): Promise<ApprovedDocumentsScanResult> {
    const rootDir = resolveApprovedDocumentsDir(params?.rootDir);
    const index = readApprovedDocuments(rootDir);

    // Indice MOONxxxxx -> tipo de documento segun Moondesk.
    const moondeskTypes = params?.moondeskTasksWorkbookPath
      ? parseMoondeskTaskTypesByCode(params.moondeskTasksWorkbookPath)
      : new Map<string, string>();

    let classifiedByName = 0;
    let classifiedByMoondesk = 0;
    let stillUnclassified = 0;
    let totalFiles = 0;
    let withSpecification = 0;
    let withDrawing = 0;
    let withArtwork = 0;

    for (const entry of index.entries.values()) {
      let hasSpecification = false;
      let hasDrawing = false;
      let hasArtwork = false;
      let unclassified = 0;

      for (const file of entry.files) {
        totalFiles += 1;
        let kind = file.kind;

        if (kind === "unknown" && file.moondeskCode) {
          const sourceType = moondeskTypes.get(file.moondeskCode);

          if (sourceType) {
            kind = kindFromMoondeskType(sourceType);
            classifiedByMoondesk += 1;
          }
        } else if (kind !== "unknown") {
          classifiedByName += 1;
        }

        if (kind === "specification") hasSpecification = true;
        else if (kind === "drawing") hasDrawing = true;
        else if (kind === "artwork") hasArtwork = true;
        else {
          unclassified += 1;
          stillUnclassified += 1;
        }
      }

      if (hasSpecification) withSpecification += 1;
      if (hasDrawing) withDrawing += 1;
      if (hasArtwork) withArtwork += 1;

      await prisma.approvedDocumentSet.upsert({
        where: { materialCode: entry.materialCode },
        update: {
          materialTypeFolder: entry.materialTypeFolder,
          folderName: entry.folderName,
          hasSpecification,
          hasDrawing,
          hasArtwork,
          moondeskCodes: entry.moondeskCodes,
          fileCount: entry.files.length,
          unclassifiedFiles: unclassified,
          scannedAt: new Date()
        },
        create: {
          materialCode: entry.materialCode,
          materialTypeFolder: entry.materialTypeFolder,
          folderName: entry.folderName,
          hasSpecification,
          hasDrawing,
          hasArtwork,
          moondeskCodes: entry.moondeskCodes,
          fileCount: entry.files.length,
          unclassifiedFiles: unclassified
        }
      });
    }

    return {
      rootDir,
      typeFolders: index.typeFolders,
      materialFolders: index.materialFolders,
      materialsWithFiles: index.entries.size,
      emptyFolders: index.emptyFolders.length,
      totalFiles,
      classifiedByName,
      classifiedByMoondesk,
      stillUnclassified,
      withSpecification,
      withDrawing,
      withArtwork,
      moondeskCodesIndexed: moondeskTypes.size
    };
  },

  /** Documentos publicados para los codigos que usan los componentes dados. */
  async getByMaterialCodes(materialCodes: string[]) {
    const codes = [...new Set(materialCodes.filter(Boolean))];

    if (!codes.length) {
      return new Map<string, Awaited<ReturnType<typeof prisma.approvedDocumentSet.findMany>>[number]>();
    }

    const sets = await prisma.approvedDocumentSet.findMany({ where: { materialCode: { in: codes } } });

    return new Map(sets.map((set) => [set.materialCode.toUpperCase(), set]));
  }
};
