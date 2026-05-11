import fs from "node:fs";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { readPmSheetsFromRequest } from "@/server/etl/excel";
import { importService } from "@/server/etl/import-service";
import { buildRecetasBomImportPayload } from "@/server/etl/recetas-bom-phase1";
import { consolidationService } from "@/server/etl/consolidation-service";

const DEFAULT_BOM_PROJECT_TOKEN = "PERPIEL HERIDAS X 40 ML";
const EXPECTED_BOM_SOURCE_RECORD_KEY =
  "recetas:recetas:perpiel-heridas-x-40-ml:root-perpiel-heridas-x-40-ml-v:frasco:component-fco-perpiel-heridas";

function usage() {
  return [
    "Usage:",
    "  npm run validate:perpiel-spray-pm-bom -- /absolute/path/to/perpiel-spray-pm.xlsx /absolute/path/to/recetas-bom.xlsx",
    "",
    "Options:",
    "  --allow-existing-data  Run even when the current DB/schema is not empty.",
    "",
    "Environment:",
    "  PERPIEL_SPRAY_PM_WORKBOOK    PM workbook path if no positional argument is passed.",
    "  PERPIEL_SPRAY_BOM_WORKBOOK   BOM workbook path if no positional argument is passed.",
    `  PERPIEL_SPRAY_PROJECT_TOKEN  BOM context token. Defaults to '${DEFAULT_BOM_PROJECT_TOKEN}'.`
  ].join("\n");
}

function getWorkbookPaths() {
  const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const pmWorkbookPath = positionalArgs[0] ?? process.env.PERPIEL_SPRAY_PM_WORKBOOK;
  const bomWorkbookPath = positionalArgs[1] ?? process.env.PERPIEL_SPRAY_BOM_WORKBOOK;

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
  return process.argv.includes("--allow-existing-data") || process.env.PERPIEL_SPRAY_ALLOW_EXISTING_DATA === "1";
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
        "PerPiel Spray PM+BOM validation expects an empty disposable DB/schema.",
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

async function main() {
  const { pmWorkbookPath, bomWorkbookPath } = getWorkbookPaths();
  const projectToken = process.env.PERPIEL_SPRAY_PROJECT_TOKEN ?? DEFAULT_BOM_PROJECT_TOKEN;
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

  const report = {
    mode: "perpiel-spray-pm-bom-phase1-validation",
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
      consolidationSummary: baselineConsolidationSummary
    },
    baseline,
    bom: {
      diagnostics: bomPayload.diagnostics,
      consolidationSummary: bomConsolidationSummary
    },
    final: finalSnapshot
  };

  console.log(JSON.stringify(report, null, 2));

  const baselineFrasco = itemBySlot(baseline, "FRASCO");
  const baselineProspecto = itemBySlot(baseline, "PROSPECTO");
  const finalFrasco = itemBySlot(finalSnapshot, "FRASCO");
  const finalProspecto = itemBySlot(finalSnapshot, "PROSPECTO");
  const frascoBomEvidence = finalFrasco?.evidences.find((evidence) => evidence.sourceType === "bom") ?? null;
  const prospectoBomEvidence = finalProspecto?.evidences.find((evidence) => evidence.sourceType === "bom") ?? null;
  const frascoBomRawData = asRecord(frascoBomEvidence?.rawData);
  const subcomponents = Array.isArray(frascoBomRawData.subcomponents) ? frascoBomRawData.subcomponents : [];
  const hasBombaTapaSubcomponent = subcomponents.some((entry) => {
    const subcomponent = asRecord(entry);

    return String(subcomponent.description ?? "").includes("BOMBA + TAPA PERPIEL HERIDAS");
  });
  const baselineFrascoAlerts = alertCodes(baselineFrasco);
  const baselineProspectoAlerts = alertCodes(baselineProspecto);
  const finalFrascoAlerts = alertCodes(finalFrasco);
  const finalProspectoAlerts = alertCodes(finalProspecto);

  if (
    pmPayload.sheets[0]?.sheetName !== "Venta Libre-FARMA" ||
    pmRawData.producto !== "Desinfectante" ||
    pmRawData.presentacion !== "40 ml -" ||
    pmRawData.drogaActiva !== "Clorhexidine" ||
    baseline.items.length !== 2 ||
    !baselineFrasco ||
    !baselineProspecto ||
    finalSnapshot.counts.projectItems !== 2 ||
    !finalFrasco ||
    !finalProspecto ||
    finalSnapshot.items.some((item) => item.componentSlot === "ESTUCHE") ||
    Boolean(prospectoBomEvidence) ||
    !frascoBomEvidence ||
    frascoBomEvidence.sourceRecordKey !== EXPECTED_BOM_SOURCE_RECORD_KEY ||
    frascoBomRawData.sourceRecordKey !== EXPECTED_BOM_SOURCE_RECORD_KEY ||
    !hasBombaTapaSubcomponent ||
    !baselineFrascoAlerts.has("PRE_BOM_MISSING") ||
    finalFrascoAlerts.has("PRE_BOM_MISSING") ||
    !baselineProspectoAlerts.has("PRE_BOM_MISSING") ||
    !finalProspectoAlerts.has("PRE_BOM_MISSING") ||
    finalSnapshot.project.healthScore <= baseline.project.healthScore
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
