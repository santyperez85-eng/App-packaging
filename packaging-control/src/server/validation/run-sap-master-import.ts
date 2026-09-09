import fs from "node:fs";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { dashboardService } from "@/server/services/dashboard-service";
import { sapMasterImportService } from "@/server/services/sap-master-import-service";

function usage() {
  return [
    "Usage:",
    "  npm run import:sap-master -- /ruta/al/Packaging_Materiales.xlsx [--sheet=Data]",
    "",
    "Sin ruta usa SAP_MASTER_WORKBOOK."
  ].join("\n");
}

function parseArgs() {
  const args = process.argv.slice(2);
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const sheetArg = args.find((arg) => arg.startsWith("--sheet="));
  const workbookPath = positional[0] ?? process.env.SAP_MASTER_WORKBOOK;

  if (!workbookPath) {
    throw new Error(`Falta la ruta del corte de SAP.\n\n${usage()}`);
  }

  const resolved = path.resolve(workbookPath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`No existe el archivo: ${resolved}`);
  }

  return { workbookPath: resolved, sheetName: sheetArg?.slice("--sheet=".length) };
}

async function main() {
  const { workbookPath, sheetName } = parseArgs();
  const result = await sapMasterImportService.importSnapshot({ workbookPath, sheetName });
  const pipeline = await dashboardService.getPipelineSnapshot();

  console.log(
    JSON.stringify(
      {
        mode: "sap-master-import",
        ...result,
        pipelineAfter: pipeline.stages.map((stage) => ({
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

  const formal = pipeline.stages.find((stage) => stage.key === "formal_material");

  // El corte debe dejar el catalogo cargado y el hito de material formal ya no
  // puede quedar como "no aplica a ningun componente".
  if (result.catalog.total === 0 || result.linkage.matched === 0 || formal?.coveragePercent === null) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
