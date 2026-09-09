import fs from "node:fs";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { consolidationService } from "@/server/etl/consolidation-service";
import { importService } from "@/server/etl/import-service";
import { resolveProjectTokens } from "@/server/etl/project-token-resolver";
import { buildRecetasBomImportPayload } from "@/server/etl/recetas-bom-phase1";
import { dashboardService } from "@/server/services/dashboard-service";

function usage() {
  return [
    "Usage:",
    "  npm run import:recetas-bulk -- /ruta/al/Estructura para carga de recetas.xlsx [--dry-run]",
    "",
    "Aplica el archivo de recetas a todos los proyectos, usando el mismo token por",
    "producto que el import de altas. El archivo de recetas suele cubrir solo una",
    "parte de la cartera: los proyectos sin bloque se reportan como no cubiertos."
  ].join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  const workbookPath = positional[0] ?? process.env.RECETAS_WORKBOOK;

  if (!workbookPath) {
    throw new Error(`Falta la ruta del archivo de recetas.\n\n${usage()}`);
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
  const specs = new Map(
    resolveProjectTokens(projects.map((project) => ({ code: project.code, productName: project.product?.name }))).map(
      (spec) => [spec.projectCode, spec]
    )
  );

  const covered: Array<{ projectCode: string; token: string; candidateBlocks: number; rows: number }> = [];
  const uncovered: string[] = [];

  for (const project of projects) {
    const spec = specs.get(project.code);

    if (!spec) {
      uncovered.push(project.code);
      continue;
    }

    try {
      const built = buildRecetasBomImportPayload({
        workbookPath: resolved,
        projectCode: project.code,
        projectToken: spec.token,
        expectedComponentSlots: project.projectItems.map((item) => item.componentSlot)
      });
      const rows = built.payload.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);

      if (!rows) {
        uncovered.push(project.code);
        continue;
      }

      if (!dryRun) {
        await importService.importBomRows(built.payload);
        await consolidationService.consolidatePendingImports();
      }

      covered.push({
        projectCode: project.code,
        token: spec.token,
        candidateBlocks: built.diagnostics.candidateBlocks.length,
        rows
      });
    } catch (error) {
      uncovered.push(`${project.code} (error: ${error instanceof Error ? error.message.slice(0, 60) : "?"})`);
    }
  }

  const pipeline = dryRun ? null : await dashboardService.getPipelineSnapshot();

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? "recetas-bulk-dry-run" : "recetas-bulk",
        projects: projects.length,
        coveredByRecipeFile: covered.length,
        notCovered: uncovered.length,
        covered,
        uncoveredSample: uncovered.slice(0, 12),
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
