import fs from "node:fs";
import path from "node:path";

import { ImportProcessStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { readPmSheetsFromRequest } from "@/server/etl/excel";
import { importService } from "@/server/etl/import-service";
import { mapPmImportRow } from "@/server/etl/import-mappers";
import { consolidationService } from "@/server/etl/consolidation-service";

function usage() {
  return [
    "Usage:",
    "  npm run validate:pm-only -- /absolute/path/to/pm.xlsx",
    "",
    "Options:",
    "  --allow-existing-data  Run even when the current DB/schema is not empty.",
    "",
    "Recommended:",
    "  Point DATABASE_URL to a disposable schema before running this script."
  ].join("\n");
}

function getWorkbookPath() {
  const positionalArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  const workbookPath = positionalArg ?? process.env.PM_WORKBOOK;

  if (!workbookPath) {
    throw new Error(`PM workbook path is required.\n\n${usage()}`);
  }

  const resolvedPath = path.resolve(workbookPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`PM workbook not found: ${resolvedPath}`);
  }

  return resolvedPath;
}

function isAllowExistingData() {
  return process.argv.includes("--allow-existing-data") || process.env.PM_ONLY_ALLOW_EXISTING_DATA === "1";
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
        "PM-only validation expects an empty disposable DB/schema.",
        `Current non-empty tables: ${populatedTables.map(([name, count]) => `${name}=${count}`).join(", ")}`,
        "Use a disposable schema, or rerun with --allow-existing-data if this is intentional."
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

function buildImportPreview(payload: Awaited<ReturnType<typeof readPmWorkbook>>) {
  return payload.sheets.flatMap((sheet) =>
    sheet.rows.map((row, index) =>
      mapPmImportRow({
        batchId: payload.batchId,
        sourceFileName: payload.sourceFileName,
        sheetName: sheet.sheetName,
        row,
        rowNumber: index + 1
      })
    )
  );
}

async function getValidationResult(batchId: string, databaseCountsBefore: Record<string, number>) {
  const importedPmRows = await prisma.importPmRow.findMany({
    where: { batchId },
    orderBy: [{ rowNumber: "asc" }]
  });
  const projectCodes = importedPmRows.map((row) => row.projectCode).filter((value): value is string => Boolean(value));
  const projects = await prisma.project.findMany({
    where: {
      OR: [
        {
          code: {
            in: projectCodes
          }
        },
        {
          sourcePmKey: {
            in: projectCodes
          }
        }
      ]
    },
    include: {
      product: true,
      alerts: {
        where: { status: "OPEN" },
        orderBy: [{ severity: "desc" }, { createdAt: "desc" }]
      },
      projectItems: {
        include: {
          evidences: {
            orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }]
          },
          alerts: {
            where: { status: "OPEN" },
            orderBy: [{ severity: "desc" }, { createdAt: "desc" }]
          }
        },
        orderBy: [{ componentSlot: "asc" }, { itemKey: "asc" }]
      }
    },
    orderBy: [{ code: "asc" }]
  });

  return {
    databaseCountsBefore,
    importedPmRows: importedPmRows.map((row) => ({
      id: row.id,
      batchId: row.batchId,
      processingStatus: row.processingStatus,
      errorMessage: row.errorMessage,
      sourceFileName: row.sourceFileName,
      sheetName: row.sheetName,
      rowNumber: row.rowNumber,
      projectCode: row.projectCode,
      projectName: row.projectName,
      productName: row.productName,
      presentation: row.presentation,
      activeIngredient: row.activeIngredient,
      templateType: row.templateType
    })),
    projects: projects.map((project) => ({
      id: project.id,
      code: project.code,
      sourcePmKey: project.sourcePmKey,
      name: project.name,
      businessUnit: project.businessUnit,
      scopeDefined: project.scopeDefined,
      status: project.status,
      healthScore: project.healthScore,
      product: project.product
        ? {
            referenceCode: project.product.referenceCode,
            name: project.product.name,
            presentation: project.product.presentation,
            businessUnit: project.product.businessUnit
          }
        : null,
      openAlerts: project.alerts.map((alert) => ({
        ruleCode: alert.ruleCode,
        severity: alert.severity,
        title: alert.title,
        message: alert.message
      })),
      projectItems: project.projectItems.map((item) => ({
        id: item.id,
        itemKey: item.itemKey,
        name: item.name,
        description: item.description,
        componentSlot: item.componentSlot,
        originMode: item.originMode,
        applicabilityStatus: item.applicabilityStatus,
        expectedStatus: item.expectedStatus,
        identificationStatus: item.identificationStatus,
        matchingStatus: item.matchingStatus,
        status: item.status,
        readinessScore: item.readinessScore,
        provisional: item.provisional,
        requiresMaterialCode: item.requiresMaterialCode,
        requiresApprovedDocument: item.requiresApprovedDocument,
        requiresTechnicalDocs: item.requiresTechnicalDocs,
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
          severity: alert.severity,
          title: alert.title,
          message: alert.message
        }))
      }))
    }))
  };
}

async function main() {
  const workbookPath = getWorkbookPath();
  const databaseCountsBefore = await assertControlledDatabase();
  const payload = await readPmWorkbook(workbookPath);
  const importPreview = buildImportPreview(payload);
  const stagingRow = payload.sheets[0]?.rows[0];
  const rawData = stagingRow?.rawData && typeof stagingRow.rawData === "object" ? stagingRow.rawData : {};

  await importService.importPmRows(payload);
  const consolidationSummary = await consolidationService.consolidatePendingImports();
  const result = await getValidationResult(payload.batchId, databaseCountsBefore);

  console.log(
    JSON.stringify(
      {
        mode: "pm-only-controlled-consolidation",
        workbookPath,
        sourceFileName: payload.sourceFileName,
        batchId: payload.batchId,
        sheetSelection: {
          selectedSheetName: payload.sheets[0]?.sheetName ?? null,
          pmSheetDetection: "pmSheetDetection" in rawData ? rawData.pmSheetDetection : null
        },
        importPreview: importPreview.map((row) => ({
          sourceFileName: row.sourceFileName,
          sheetName: row.sheetName,
          rowNumber: row.rowNumber,
          projectCode: row.projectCode,
          projectName: row.projectName,
          productName: row.productName,
          presentation: row.presentation,
          activeIngredient: row.activeIngredient,
          templateType: row.templateType
        })),
        consolidationSummary,
        result
      },
      null,
      2
    )
  );

  const failedRows = result.importedPmRows.filter((row) => row.processingStatus === ImportProcessStatus.ERROR);

  if (failedRows.length > 0) {
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
