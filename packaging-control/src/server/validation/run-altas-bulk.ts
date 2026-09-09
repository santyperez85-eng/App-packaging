import fs from "node:fs";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { buildAltaMatMaterialRequestImportPayload } from "@/server/etl/alta-mat-material-requests";
import { consolidationService } from "@/server/etl/consolidation-service";
import { importService } from "@/server/etl/import-service";
import { resolveProjectTokens } from "@/server/etl/project-token-resolver";
import { dashboardService } from "@/server/services/dashboard-service";

function usage() {
  return [
    "Usage:",
    "  npm run import:altas-bulk -- /ruta/al/Control de Vistas materiales dado de alta.xlsx [--dry-run]",
    "",
    "Aplica el archivo de altas a todos los proyectos de la base, derivando el token",
    "de cada producto y sus tokens negativos para evitar contaminacion cruzada."
  ].join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  const workbookPath = positional[0] ?? process.env.ALTAS_WORKBOOK;

  if (!workbookPath) {
    throw new Error(`Falta la ruta del archivo de altas.\n\n${usage()}`);
  }

  const resolved = path.resolve(workbookPath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`No existe el archivo: ${resolved}`);
  }

  const projects = await prisma.project.findMany({
    include: {
      product: { select: { name: true } },
      projectItems: { select: { componentSlot: true } }
    },
    orderBy: { code: "asc" }
  });

  const specs = resolveProjectTokens(
    projects.map((project) => ({ code: project.code, productName: project.product?.name }))
  );
  const specByCode = new Map(specs.map((spec) => [spec.projectCode, spec]));

  const results: Array<{
    projectCode: string;
    token: string;
    excludeTokens: string[];
    source: string;
    candidates: number;
    excludedByNegativeToken: number;
  }> = [];

  for (const project of projects) {
    const spec = specByCode.get(project.code);

    if (!spec) {
      results.push({
        projectCode: project.code,
        token: "(sin token derivable)",
        excludeTokens: [],
        source: "none",
        candidates: 0,
        excludedByNegativeToken: 0
      });
      continue;
    }

    const built = buildAltaMatMaterialRequestImportPayload({
      workbookPath: resolved,
      projectCode: project.code,
      projectToken: spec.token,
      excludeProjectTokens: spec.excludeTokens,
      expectedComponentSlots: project.projectItems.map((item) => item.componentSlot)
    });

    if (!dryRun && built.diagnostics.candidates.length) {
      await importService.importMaterialRequestRows(built.payload);
      await consolidationService.consolidatePendingImports();
    }

    results.push({
      projectCode: project.code,
      token: spec.token,
      excludeTokens: spec.excludeTokens,
      source: spec.source,
      candidates: built.diagnostics.candidates.length,
      excludedByNegativeToken: built.diagnostics.ignoredByReason.excluded_by_negative_token ?? 0
    });
  }

  const withCandidates = results.filter((result) => result.candidates > 0);
  const pipeline = dryRun ? null : await dashboardService.getPipelineSnapshot();
  const itemsWithRequest = dryRun ? 0 : await prisma.projectItem.count({ where: { materialRequestId: { not: null } } });

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? "altas-bulk-dry-run" : "altas-bulk",
        projects: projects.length,
        projectsWithCandidates: withCandidates.length,
        totalCandidates: results.reduce((sum, result) => sum + result.candidates, 0),
        itemsWithRequest,
        overrides: results.filter((result) => result.source === "override"),
        withCandidates,
        pipeline: pipeline?.stages.map((stage) => ({
          key: stage.key,
          coveragePercent: stage.coveragePercent,
          ready: stage.ready,
          partial: stage.partial,
          missing: stage.missing,
          notApplicable: stage.notApplicable
        }))
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
