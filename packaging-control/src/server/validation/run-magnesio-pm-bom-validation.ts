import fs from "node:fs";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { readPmSheetsFromRequest } from "@/server/etl/excel";
import { importService } from "@/server/etl/import-service";
import { buildRecetasBomImportPayload } from "@/server/etl/recetas-bom-phase1";
import { consolidationService } from "@/server/etl/consolidation-service";

const DEFAULT_BOM_PROJECT_TOKEN = "MAGNESIO EN POLVO X 150G";

function usage() {
  return [
    "Usage:",
    "  npm run validate:magnesio-pm-bom -- /absolute/path/to/magnesio-pm.xlsx /absolute/path/to/recetas-bom.xlsx",
    "",
    "Options:",
    "  --allow-existing-data  Run even when the current DB/schema is not empty.",
    "",
    "Environment:",
    "  MAGNESIO_PM_WORKBOOK     PM workbook path if no positional argument is passed.",
    "  MAGNESIO_BOM_WORKBOOK    BOM workbook path if no positional argument is passed.",
    `  MAGNESIO_PROJECT_TOKEN   BOM context token. Defaults to '${DEFAULT_BOM_PROJECT_TOKEN}'.`
  ].join("\n");
}

function getWorkbookPaths() {
  const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const pmWorkbookPath = positionalArgs[0] ?? process.env.MAGNESIO_PM_WORKBOOK;
  const bomWorkbookPath = positionalArgs[1] ?? process.env.MAGNESIO_BOM_WORKBOOK;

  if (!pmWorkbookPath || !bomWorkbookPath) {
    throw new Error(`PM and BOM workbook paths are required.\n\n${usage()}`);
  }

  const resolvedPmPath = path.resolve(pmWorkbookPath);
  const resolvedBomPath = path.resolve(bomWorkbookPath);

  if (!fs.existsSync(resolvedPmPath)) {
    throw new Error(`PM workbook not found: ${resolvedPmPath}`);
  }

  if (!fs.existsSync(resolvedBomPath)) {
    throw new Error(`BOM workbook not found: ${resolvedBomPath}`);
  }

  return {
    pmWorkbookPath: resolvedPmPath,
    bomWorkbookPath: resolvedBomPath
  };
}

function isAllowExistingData() {
  return process.argv.includes("--allow-existing-data") || process.env.MAGNESIO_ALLOW_EXISTING_DATA === "1";
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
        "Magnesio PM+BOM validation expects an empty disposable DB/schema.",
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

async function getImportedPmRow(batchId: string) {
  const row = await prisma.importPmRow.findFirst({
    where: { batchId },
    orderBy: [{ rowNumber: "asc" }]
  });

  if (!row) {
    throw new Error(`No imported PM row found for batch ${batchId}`);
  }

  return row;
}

async function getProjectSnapshot(projectCode: string) {
  const project = await prisma.project.findUnique({
    where: { code: projectCode },
    include: {
      bomItems: {
        orderBy: [{ componentName: "asc" }]
      },
      projectItems: {
        include: {
          bomItem: true,
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

  return {
    project: {
      code: project.code,
      name: project.name,
      status: project.status,
      healthScore: project.healthScore,
      openAlertCount: project.alerts.length
    },
    counts: {
      bomItems: project.bomItems.length,
      projectItems: project.projectItems.length,
      projectItemEvidences: project.projectItems.reduce((total, item) => total + item.evidences.length, 0)
    },
    bomItems: project.bomItems.map((item) => ({
      componentKey: item.componentKey,
      componentName: item.componentName,
      componentType: item.componentType,
      quantity: item.quantity,
      unit: item.unit,
      notes: item.notes
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
      bomItemKey: item.bomItem?.componentKey ?? null,
      evidences: item.evidences.map((evidence) => ({
        sourceType: evidence.sourceType,
        sourceRecordKey: evidence.sourceRecordKey,
        matchRule: evidence.matchRule,
        matchConfidence: evidence.matchConfidence,
        matchStatus: evidence.matchStatus,
        rawLabel: evidence.rawLabel,
        rawData: evidence.rawData
      })),
      openAlerts: item.alerts.map((alert) => ({
        ruleCode: alert.ruleCode,
        severity: alert.severity,
        title: alert.title
      }))
    }))
  };
}

function itemBySlot(snapshot: Awaited<ReturnType<typeof getProjectSnapshot>>, slot: string) {
  return snapshot.items.find((item) => item.componentSlot === slot) ?? null;
}

function alertCodes(item: ReturnType<typeof itemBySlot>) {
  return new Set((item?.openAlerts ?? []).map((alert) => alert.ruleCode));
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function hasSubcomponentKind(
  candidateBlocks: Awaited<ReturnType<typeof buildRecetasBomImportPayload>>["diagnostics"]["candidateBlocks"],
  kind: string
) {
  return candidateBlocks.some((candidate) => candidate.subcomponents.some((subcomponent) => subcomponent.kind === kind));
}

async function main() {
  const { pmWorkbookPath, bomWorkbookPath } = getWorkbookPaths();
  const projectToken = process.env.MAGNESIO_PROJECT_TOKEN ?? DEFAULT_BOM_PROJECT_TOKEN;
  const databaseCountsBefore = await assertControlledDatabase();
  const pmPayload = await readPmWorkbook(pmWorkbookPath);
  const pmStagingRow = pmPayload.sheets[0]?.rows[0];
  const pmRawData = asRecord(pmStagingRow?.rawData);

  await importService.importPmRows(pmPayload);
  const baselineConsolidationSummary = await consolidationService.consolidatePendingImports();
  const importedPmRow = await getImportedPmRow(pmPayload.batchId);
  const baseline = await getProjectSnapshot(importedPmRow.projectCode ?? "");
  const expectedComponentSlots = baseline.items.map((item) => item.componentSlot);
  const bomPayload = buildRecetasBomImportPayload({
    workbookPath: bomWorkbookPath,
    projectCode: importedPmRow.projectCode ?? "",
    projectToken,
    expectedComponentSlots
  });

  await importService.importBomRows(bomPayload.payload);
  const bomConsolidationSummary = await consolidationService.consolidatePendingImports();
  const finalSnapshot = await getProjectSnapshot(importedPmRow.projectCode ?? "");
  const frascoCandidateBlocks = bomPayload.diagnostics.candidateBlocks.filter(
    (candidate) => candidate.componentSlot === "FRASCO"
  );
  const selectedFrascoBlocks = frascoCandidateBlocks.filter((candidate) => candidate.selectionStatus === "selected");
  const ambiguousFrascoBlocks = frascoCandidateBlocks.filter(
    (candidate) => candidate.selectionStatus === "ambiguous_duplicate_slot_across_blocks"
  );
  const finalFrasco = itemBySlot(finalSnapshot, "FRASCO");
  const frascoBomEvidence = finalFrasco?.evidences.find((evidence) => evidence.sourceType === "bom") ?? null;
  const frascoAlerts = alertCodes(finalFrasco);
  const hasClearBomWinner = selectedFrascoBlocks.length === 1 && bomPayload.diagnostics.normalizedRows === 1;
  const hasAmbiguousBom = ambiguousFrascoBlocks.length > 1 && bomPayload.diagnostics.normalizedRows === 0;

  const report = {
    mode: "magnesio-pm-bom-phase1-validation",
    pmWorkbookPath,
    bomWorkbookPath,
    projectToken,
    databaseCountsBefore,
    pm: {
      sourceFileName: pmPayload.sourceFileName,
      selectedSheet: pmPayload.sheets[0]?.sheetName ?? null,
      producto: pmRawData.producto ?? null,
      presentacion: pmRawData.presentacion ?? null,
      drogaActiva: pmRawData.drogaActiva ?? null,
      templateType: pmRawData.templateType ?? null,
      pmSheetDetection: pmRawData.pmSheetDetection ?? null,
      derivedSlots: baseline.items.map((item) => item.componentSlot),
      consolidationSummary: baselineConsolidationSummary
    },
    bom: {
      diagnostics: bomPayload.diagnostics,
      frascoCandidateBlocks,
      selection: hasClearBomWinner
        ? {
            status: "selected",
            reason: selectedFrascoBlocks[0]?.selectionReason ?? null,
            blockStartRow: selectedFrascoBlocks[0]?.blockStartRow ?? null,
            blockEndRow: selectedFrascoBlocks[0]?.blockEndRow ?? null
          }
        : {
            status: "manual_review",
            reason:
              ambiguousFrascoBlocks[0]?.selectionReason ??
              "No single BOM/Recetas block could be selected conservatively.",
            candidateCount: ambiguousFrascoBlocks.length
          },
      consolidationSummary: bomConsolidationSummary
    },
    final: finalSnapshot
  };

  console.log(JSON.stringify(report, null, 2));

  const baselineFrasco = itemBySlot(baseline, "FRASCO");
  const baselineFrascoAlerts = alertCodes(baselineFrasco);
  const forbiddenSlots = new Set(["BLISTER", "ESTUCHE", "PROSPECTO", "ETIQUETA"]);

  if (
    pmPayload.sheets[0]?.sheetName !== "Complemento Nutricional" ||
    baseline.items.length !== 1 ||
    baselineFrasco?.componentSlot !== "FRASCO" ||
    expectedComponentSlots.join(",") !== "FRASCO" ||
    finalSnapshot.counts.projectItems !== 1 ||
    finalFrasco?.componentSlot !== "FRASCO" ||
    finalSnapshot.items.some((item) => forbiddenSlots.has(item.componentSlot)) ||
    finalSnapshot.counts.bomItems !== (hasClearBomWinner ? 1 : 0) ||
    frascoCandidateBlocks.length !== 2 ||
    !hasSubcomponentKind(frascoCandidateBlocks, "TAPA") ||
    !hasSubcomponentKind(frascoCandidateBlocks, "CUCHARA") ||
    !hasSubcomponentKind(frascoCandidateBlocks, "ETIQUETA") ||
    !baselineFrascoAlerts.has("PRE_BOM_MISSING") ||
    (hasAmbiguousBom && (Boolean(frascoBomEvidence) || !frascoAlerts.has("PRE_BOM_MISSING"))) ||
    (hasClearBomWinner && (!frascoBomEvidence || frascoAlerts.has("PRE_BOM_MISSING"))) ||
    (!hasAmbiguousBom && !hasClearBomWinner)
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
