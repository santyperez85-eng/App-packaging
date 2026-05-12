import fs from "node:fs";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { readPmSheetsFromRequest } from "@/server/etl/excel";
import { consolidationService } from "@/server/etl/consolidation-service";
import { importService } from "@/server/etl/import-service";
import { buildRecetasBomImportPayload } from "@/server/etl/recetas-bom-phase1";
import { projectItemLifecycleService } from "@/server/services/project-item-lifecycle-service";
import {
  buildPyloberMaterialRequestsPayload,
  buildPyloberPmPayload,
  pyloberValidationProjectCode
} from "@/server/validation/pm-material-request-validation-fixture";

function usage() {
  return [
    "Usage:",
    "  npm run validate:project-item-lifecycle -- /absolute/path/to/perpiel-spray-pm.xlsx /absolute/path/to/magnesio-pm.xlsx /absolute/path/to/recetas-bom.xlsx",
    "",
    "Options:",
    "  --allow-existing-data  Run even when the current DB/schema is not empty.",
    "",
    "Environment:",
    "  LIFECYCLE_SPRAY_PM_WORKBOOK     PerPiel Spray PM workbook path.",
    "  LIFECYCLE_MAGNESIO_PM_WORKBOOK  Magnesio PM workbook path.",
    "  LIFECYCLE_BOM_WORKBOOK          Recetas BOM workbook path."
  ].join("\n");
}

function getWorkbookPaths() {
  const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const sprayPmWorkbookPath = positionalArgs[0] ?? process.env.LIFECYCLE_SPRAY_PM_WORKBOOK;
  const magnesioPmWorkbookPath = positionalArgs[1] ?? process.env.LIFECYCLE_MAGNESIO_PM_WORKBOOK;
  const bomWorkbookPath = positionalArgs[2] ?? process.env.LIFECYCLE_BOM_WORKBOOK;

  if (!sprayPmWorkbookPath || !magnesioPmWorkbookPath || !bomWorkbookPath) {
    throw new Error(`Workbook paths are required.\n\n${usage()}`);
  }

  const resolved = {
    sprayPmWorkbookPath: path.resolve(sprayPmWorkbookPath),
    magnesioPmWorkbookPath: path.resolve(magnesioPmWorkbookPath),
    bomWorkbookPath: path.resolve(bomWorkbookPath)
  };

  for (const workbookPath of Object.values(resolved)) {
    if (!fs.existsSync(workbookPath)) {
      throw new Error(`Workbook not found: ${workbookPath}`);
    }
  }

  return resolved;
}

function isAllowExistingData() {
  return process.argv.includes("--allow-existing-data") || process.env.LIFECYCLE_ALLOW_EXISTING_DATA === "1";
}

async function assertControlledDatabase() {
  const [
    products,
    projects,
    projectItems,
    projectItemEvidences,
    alerts,
    pmRows,
    materialMasterRows,
    materialRequestRows,
    bomRows,
    materialsMaster,
    materialRequests,
    bomItems
  ] = await Promise.all([
    prisma.product.count(),
    prisma.project.count(),
    prisma.projectItem.count(),
    prisma.projectItemEvidence.count(),
    prisma.alert.count(),
    prisma.importPmRow.count(),
    prisma.importMaterialMasterRow.count(),
    prisma.importMaterialRequestRow.count(),
    prisma.importBomRow.count(),
    prisma.materialsMaster.count(),
    prisma.materialRequest.count(),
    prisma.bomItem.count()
  ]);
  const counts = {
    products,
    projects,
    projectItems,
    projectItemEvidences,
    alerts,
    pmRows,
    materialMasterRows,
    materialRequestRows,
    bomRows,
    materialsMaster,
    materialRequests,
    bomItems
  };
  const populatedTables = Object.entries(counts).filter(([, count]) => count > 0);

  if (populatedTables.length > 0 && !isAllowExistingData()) {
    throw new Error(
      [
        "Project item lifecycle validation expects an empty disposable DB/schema.",
        `Current non-empty tables: ${populatedTables.map(([name, count]) => `${name}=${count}`).join(", ")}`,
        "Point DATABASE_URL to a disposable schema, or rerun with --allow-existing-data if this is intentional."
      ].join("\n")
    );
  }

  return counts;
}

async function readPmWorkbook(workbookPath: string) {
  const formData = new FormData();
  const buffer = fs.readFileSync(workbookPath);

  formData.append(
    "file",
    new File([buffer], path.basename(workbookPath), {
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

async function getImportedPmProjectCode(batchId: string) {
  const row = await prisma.importPmRow.findFirst({
    where: { batchId },
    orderBy: [{ rowNumber: "asc" }]
  });

  if (!row?.projectCode) {
    throw new Error(`No imported PM project code found for batch ${batchId}`);
  }

  return row.projectCode;
}

async function getProjectItemId(projectCode: string, componentSlot: string) {
  const item = await prisma.projectItem.findFirst({
    where: {
      project: { code: projectCode },
      componentSlot: componentSlot as never
    },
    orderBy: [{ itemKey: "asc" }]
  });

  if (!item) {
    throw new Error(`Project item not found for ${projectCode}/${componentSlot}`);
  }

  return item.id;
}

function milestoneStatus(
  lifecycle: Awaited<ReturnType<typeof projectItemLifecycleService.getProjectItemLifecycle>>,
  key: string
) {
  return lifecycle.milestones.find((milestone) => milestone.key === key)?.status ?? null;
}

function hasAlert(
  lifecycle: Awaited<ReturnType<typeof projectItemLifecycleService.getProjectItemLifecycle>>,
  ruleCode: string
) {
  return lifecycle.alerts.some((alert) => alert.status === "OPEN" && alert.ruleCode === ruleCode);
}

async function importPyloberFixture() {
  const pmPayload = buildPyloberPmPayload();
  const altasPayload = buildPyloberMaterialRequestsPayload();

  await importService.importPmRows(pmPayload);
  const pmSummary = await consolidationService.consolidatePendingImports();
  await importService.importMaterialRequestRows(altasPayload);
  const altasSummary = await consolidationService.consolidatePendingImports();

  return {
    projectCode: pyloberValidationProjectCode,
    pmSummary,
    altasSummary
  };
}

async function importPmBomCase(params: {
  pmWorkbookPath: string;
  bomWorkbookPath: string;
  projectToken: string;
}) {
  const pmPayload = await readPmWorkbook(params.pmWorkbookPath);

  await importService.importPmRows(pmPayload);
  const pmSummary = await consolidationService.consolidatePendingImports();
  const projectCode = await getImportedPmProjectCode(pmPayload.batchId);
  const projectItems = await prisma.projectItem.findMany({
    where: { project: { code: projectCode } },
    orderBy: [{ componentSlot: "asc" }]
  });
  const bomPayload = buildRecetasBomImportPayload({
    workbookPath: params.bomWorkbookPath,
    projectCode,
    projectToken: params.projectToken,
    expectedComponentSlots: projectItems.map((item) => item.componentSlot)
  });

  await importService.importBomRows(bomPayload.payload);
  const bomSummary = await consolidationService.consolidatePendingImports();

  return {
    projectCode,
    pmSummary,
    bomSummary,
    bomDiagnostics: bomPayload.diagnostics
  };
}

async function main() {
  const { sprayPmWorkbookPath, magnesioPmWorkbookPath, bomWorkbookPath } = getWorkbookPaths();
  const databaseCountsBefore = await assertControlledDatabase();
  const pylober = await importPyloberFixture();
  const spray = await importPmBomCase({
    pmWorkbookPath: sprayPmWorkbookPath,
    bomWorkbookPath,
    projectToken: "PERPIEL HERIDAS X 40 ML"
  });
  const magnesio = await importPmBomCase({
    pmWorkbookPath: magnesioPmWorkbookPath,
    bomWorkbookPath,
    projectToken: "MAGNESIO EN POLVO X 150G"
  });

  const pyloberEstuche = await projectItemLifecycleService.getProjectItemLifecycle(
    await getProjectItemId(pylober.projectCode, "ESTUCHE")
  );
  const sprayFrasco = await projectItemLifecycleService.getProjectItemLifecycle(
    await getProjectItemId(spray.projectCode, "FRASCO")
  );
  const magnesioFrasco = await projectItemLifecycleService.getProjectItemLifecycle(
    await getProjectItemId(magnesio.projectCode, "FRASCO")
  );
  const report = {
    mode: "project-item-lifecycle-read-model-validation",
    databaseCountsBefore,
    imports: {
      pylober,
      spray: {
        projectCode: spray.projectCode,
        pmSummary: spray.pmSummary,
        bomSummary: spray.bomSummary,
        bomCandidateBlocks: spray.bomDiagnostics.candidateBlocks
      },
      magnesio: {
        projectCode: magnesio.projectCode,
        pmSummary: magnesio.pmSummary,
        bomSummary: magnesio.bomSummary,
        bomCandidateBlocks: magnesio.bomDiagnostics.candidateBlocks
      }
    },
    lifecycles: {
      pyloberEstuche,
      sprayFrasco,
      magnesioFrasco
    }
  };

  console.log(JSON.stringify(report, null, 2));

  if (
    milestoneStatus(pyloberEstuche, "expectation") !== "ready" ||
    milestoneStatus(pyloberEstuche, "code_request") !== "partial" ||
    hasAlert(pyloberEstuche, "CODE_NOT_REQUESTED") ||
    milestoneStatus(sprayFrasco, "pre_sap_structure") !== "partial" ||
    !hasAlert(sprayFrasco, "PRE_BOM_PENDING_CONFIRMATION") ||
    hasAlert(sprayFrasco, "PRE_BOM_MISSING") ||
    milestoneStatus(magnesioFrasco, "pre_sap_structure") !== "missing" ||
    !hasAlert(magnesioFrasco, "PRE_BOM_MISSING") ||
    magnesioFrasco.evidences.primary.some((evidence) => evidence.sourceType === "bom") ||
    magnesioFrasco.reconstructionGaps.length === 0 ||
    magnesio.bomDiagnostics.candidateBlocks.length !== 2
  ) {
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
