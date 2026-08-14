import fs from "node:fs";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { consolidationService } from "@/server/etl/consolidation-service";
import { readPmSheetsFromRequest } from "@/server/etl/excel";
import { importService } from "@/server/etl/import-service";
import {
  discoverPmWorkbooks,
  resolvePmSourceDir,
  type PmWorkbookCandidate
} from "@/server/etl/pm-source-folder";

type ImportOutcome =
  | { status: "imported"; projectCode: string; itemsCreated: number }
  | { status: "skipped_existing"; projectCode: string }
  | { status: "superseded_version"; projectCode: string; supersededBy: string }
  | { status: "no_project_code" }
  | { status: "failed"; error: string };

export type PmFolderImportResult = {
  rootDir: string;
  discovery: {
    foldersScanned: number;
    filesScanned: number;
    candidates: number;
    ignored: Array<{ fileName: string; productFolder: string | null; reason: string }>;
  };
  processed: Array<{
    fileName: string;
    productFolder: string | null;
    modifiedAt: string;
    outcome: ImportOutcome;
  }>;
  summary: {
    imported: number;
    skippedExisting: number;
    supersededVersions: number;
    failed: number;
    withoutProjectCode: number;
  };
};

async function readPmWorkbook(filePath: string) {
  const formData = new FormData();
  const buffer = fs.readFileSync(filePath);

  formData.append(
    "file",
    new File([buffer], path.basename(filePath), {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    })
  );

  return readPmSheetsFromRequest(
    new Request("http://local/imports/pm", {
      method: "POST",
      body: formData
    })
  );
}

async function stagedProjectCode(batchId: string) {
  const row = await prisma.importPmRow.findFirst({
    where: { batchId },
    orderBy: [{ rowNumber: "asc" }],
    select: { projectCode: true }
  });

  return row?.projectCode ?? null;
}

export const pmFolderImportService = {
  /**
   * Importa las planillas PM de una carpeta local (OneDrive sincronizado).
   *
   * Un archivo que falla no aborta la corrida: se reporta y se sigue, para poder
   * cargar muchos productos de una y ver despues que casos no soporta el adapter.
   *
   * Desempate de versiones: los candidatos llegan ordenados por fecha de
   * modificacion descendente y el projectCode se deriva del contenido, asi que
   * si dos archivos resuelven al mismo proyecto el mas reciente gana y el resto
   * queda marcado como version superada (no se consolida y no pisa nada).
   */
  async importFromFolder(options?: {
    rootDir?: string;
    /** Solo estos productos (match parcial contra carpeta o nombre de archivo). */
    products?: string[];
    /** Corta despues de N archivos procesados. Util para probar de a poco. */
    limit?: number;
    /** Reimporta proyectos que ya existen en la base. Por defecto se saltean. */
    force?: boolean;
  }): Promise<PmFolderImportResult> {
    const rootDir = resolvePmSourceDir(options?.rootDir);
    const discovery = discoverPmWorkbooks(rootDir);
    const productFilters = (options?.products ?? []).map((value) => value.toLowerCase());

    const selected = productFilters.length
      ? discovery.candidates.filter((candidate) => {
          const haystack = `${candidate.productFolder ?? ""} ${candidate.fileName}`.toLowerCase();

          return productFilters.some((filter) => haystack.includes(filter));
        })
      : discovery.candidates;

    const processed: PmFolderImportResult["processed"] = [];
    const seenProjectCodes = new Map<string, string>();
    const summary = { imported: 0, skippedExisting: 0, supersededVersions: 0, failed: 0, withoutProjectCode: 0 };

    for (const candidate of selected) {
      if (options?.limit && processed.length >= options.limit) {
        break;
      }

      const outcome = await this.importCandidate(candidate, seenProjectCodes, Boolean(options?.force));

      processed.push({
        fileName: candidate.fileName,
        productFolder: candidate.productFolder,
        modifiedAt: candidate.modifiedAt.toISOString(),
        outcome
      });

      switch (outcome.status) {
        case "imported":
          summary.imported += 1;
          break;
        case "skipped_existing":
          summary.skippedExisting += 1;
          break;
        case "superseded_version":
          summary.supersededVersions += 1;
          break;
        case "failed":
          summary.failed += 1;
          break;
        case "no_project_code":
          summary.withoutProjectCode += 1;
          break;
      }
    }

    return {
      rootDir,
      discovery: {
        foldersScanned: discovery.foldersScanned,
        filesScanned: discovery.filesScanned,
        candidates: discovery.candidates.length,
        ignored: discovery.ignored
      },
      processed,
      summary
    };
  },

  async importCandidate(
    candidate: PmWorkbookCandidate,
    seenProjectCodes: Map<string, string>,
    force: boolean
  ): Promise<ImportOutcome> {
    let batchId: string | null = null;

    try {
      const payload = await readPmWorkbook(candidate.filePath);
      batchId = payload.batchId;

      await importService.importPmRows(payload);
      const projectCode = await stagedProjectCode(payload.batchId);

      if (!projectCode) {
        await prisma.importPmRow.deleteMany({ where: { batchId: payload.batchId } });

        return { status: "no_project_code" };
      }

      const alreadySeen = seenProjectCodes.get(projectCode);

      if (alreadySeen) {
        // Otro archivo mas reciente ya cubrio este proyecto: no consolidar.
        await prisma.importPmRow.deleteMany({ where: { batchId: payload.batchId } });

        return { status: "superseded_version", projectCode, supersededBy: alreadySeen };
      }

      if (!force) {
        const existing = await prisma.project.findUnique({ where: { code: projectCode }, select: { id: true } });

        if (existing) {
          await prisma.importPmRow.deleteMany({ where: { batchId: payload.batchId } });
          seenProjectCodes.set(projectCode, candidate.fileName);

          return { status: "skipped_existing", projectCode };
        }
      }

      await consolidationService.consolidatePendingImports();
      seenProjectCodes.set(projectCode, candidate.fileName);

      const itemsCreated = await prisma.projectItem.count({
        where: { project: { code: projectCode } }
      });

      return { status: "imported", projectCode, itemsCreated };
    } catch (error) {
      // El staging del archivo fallido no debe quedar pendiente y contaminar la
      // proxima consolidacion.
      if (batchId) {
        await prisma.importPmRow.deleteMany({ where: { batchId } }).catch(() => undefined);
      }

      return { status: "failed", error: error instanceof Error ? error.message : String(error) };
    }
  }
};
