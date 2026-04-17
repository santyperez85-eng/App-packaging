import fs from "node:fs";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { buildAltaMatMaterialRequestImportPayload } from "@/server/etl/alta-mat-material-requests";
import { consolidationService } from "@/server/etl/consolidation-service";
import { importService } from "@/server/etl/import-service";
import { buildPyloberPmPayload, pyloberValidationProjectCode } from "@/server/validation/pm-material-request-validation-fixture";

function usage() {
  return [
    "Usage:",
    "  npm run validate:alta-mat-real -- /absolute/path/to/alta-mat.xlsx",
    "",
    "Options:",
    "  --allow-existing-data  Run even when the current DB/schema is not empty.",
    "",
    "Environment:",
    "  ALTA_MAT_WORKBOOK      Workbook path if no positional argument is passed.",
    "  ALTA_MAT_PROJECT_CODE  Project code to import into. Defaults to PYLOBER.",
    "  ALTA_MAT_PROJECT_TOKEN Project token used to filter Alta de Mat. Defaults to PYLOBER."
  ].join("\n");
}

function getWorkbookPath() {
  const positionalArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  const workbookPath = positionalArg ?? process.env.ALTA_MAT_WORKBOOK;

  if (!workbookPath) {
    throw new Error(`Alta de Mat workbook path is required.\n\n${usage()}`);
  }

  const resolvedPath = path.resolve(workbookPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Alta de Mat workbook not found: ${resolvedPath}`);
  }

  return resolvedPath;
}

function isAllowExistingData() {
  return process.argv.includes("--allow-existing-data") || process.env.ALTA_MAT_ALLOW_EXISTING_DATA === "1";
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
        "Alta de Mat real validation expects an empty disposable DB/schema.",
        `Current non-empty tables: ${populatedTables.map(([name, count]) => `${name}=${count}`).join(", ")}`,
        "Point DATABASE_URL to a disposable schema, or rerun with --allow-existing-data if this is intentional."
      ].join("\n")
    );
  }

  return counts;
}

async function getProjectSnapshot(projectCode: string) {
  const project = await prisma.project.findUnique({
    where: { code: projectCode },
    include: {
      materialRequests: {
        orderBy: [{ requestCode: "asc" }, { createdAt: "asc" }]
      },
      projectItems: {
        include: {
          materialRequest: true,
          evidences: {
            orderBy: [{ sourceType: "asc" }, { sourceRecordKey: "asc" }]
          },
          alerts: {
            where: { status: "OPEN" },
            orderBy: [{ severity: "desc" }, { ruleCode: "asc" }]
          }
        },
        orderBy: [{ componentSlot: "asc" }, { itemKey: "asc" }]
      },
      alerts: {
        where: { status: "OPEN" }
      }
    }
  });

  if (!project) {
    throw new Error(`Project not found: ${projectCode}`);
  }

  const slotCounts = project.projectItems.reduce<Record<string, number>>((counts, item) => {
    counts[item.componentSlot] = (counts[item.componentSlot] ?? 0) + 1;
    return counts;
  }, {});

  return {
    project: {
      code: project.code,
      name: project.name,
      status: project.status,
      healthScore: project.healthScore,
      openAlertCount: project.alerts.length
    },
    counts: {
      projectItems: project.projectItems.length,
      materialRequests: project.materialRequests.length,
      projectItemEvidences: project.projectItems.reduce((total, item) => total + item.evidences.length, 0),
      duplicateSlots: Object.entries(slotCounts)
        .filter(([, count]) => count > 1)
        .map(([componentSlot, count]) => ({ componentSlot, count }))
    },
    materialRequests: project.materialRequests.map((request) => ({
      requestCode: request.requestCode,
      requestStatus: request.requestStatus,
      requestedDescription: request.requestedDescription,
      linkedMaterialCode: request.linkedMaterialCode,
      notes: request.notes
    })),
    items: project.projectItems.map((item) => ({
      itemKey: item.itemKey,
      name: item.name,
      componentSlot: item.componentSlot,
      originMode: item.originMode,
      expectedStatus: item.expectedStatus,
      identificationStatus: item.identificationStatus,
      matchingStatus: item.matchingStatus,
      status: item.status,
      readinessScore: item.readinessScore,
      materialRequestCode: item.materialRequest?.requestCode ?? null,
      provisionalCode: item.provisionalCode,
      expectedMaterialCode: item.expectedMaterialCode,
      evidences: item.evidences.map((evidence) => ({
        sourceType: evidence.sourceType,
        sourceRecordKey: evidence.sourceRecordKey,
        matchRule: evidence.matchRule,
        matchConfidence: evidence.matchConfidence,
        matchStatus: evidence.matchStatus,
        isPrimary: evidence.isPrimary,
        rawLabel: evidence.rawLabel,
        rawData: evidence.rawData
      })),
      openAlerts: item.alerts.map((alert) => ({
        ruleCode: alert.ruleCode,
        type: alert.type,
        title: alert.title,
        severity: alert.severity
      }))
    }))
  };
}

async function main() {
  const workbookPath = getWorkbookPath();
  const projectCode = process.env.ALTA_MAT_PROJECT_CODE ?? pyloberValidationProjectCode;
  const projectToken = process.env.ALTA_MAT_PROJECT_TOKEN ?? "PYLOBER";
  const databaseCountsBefore = await assertControlledDatabase();
  const pmPayload = buildPyloberPmPayload();

  await importService.importPmRows(pmPayload);
  const baselineConsolidationSummary = await consolidationService.consolidatePendingImports();
  const baseline = await getProjectSnapshot(projectCode);
  const expectedComponentSlots = baseline.items.map((item) => item.componentSlot);
  const altaMat = buildAltaMatMaterialRequestImportPayload({
    workbookPath,
    projectCode,
    projectToken,
    expectedComponentSlots
  });

  await importService.importMaterialRequestRows(altaMat.payload);
  const altaMatConsolidationSummary = await consolidationService.consolidatePendingImports();
  const finalSnapshot = await getProjectSnapshot(projectCode);

  const report = {
    mode: "alta-mat-real-controlled-validation",
    workbookPath,
    databaseCountsBefore,
    baseline: {
      consolidationSummary: baselineConsolidationSummary,
      ...baseline
    },
    altaMat: {
      diagnostics: altaMat.diagnostics,
      consolidationSummary: altaMatConsolidationSummary
    },
    final: finalSnapshot
  };

  console.log(JSON.stringify(report, null, 2));

  if (finalSnapshot.counts.projectItems !== 4 || finalSnapshot.counts.duplicateSlots.length > 0) {
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
