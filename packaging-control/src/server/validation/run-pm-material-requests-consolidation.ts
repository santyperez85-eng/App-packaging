import { ImportProcessStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { consolidationService } from "@/server/etl/consolidation-service";
import { importService } from "@/server/etl/import-service";
import {
  buildPyloberMaterialRequestsPayload,
  buildPyloberPmPayload,
  pyloberValidationProjectCode
} from "@/server/validation/pm-material-request-validation-fixture";

function isAllowExistingData() {
  return process.argv.includes("--allow-existing-data") || process.env.PM_PLUS_ALTAS_ALLOW_EXISTING_DATA === "1";
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
        "PM + altas validation expects an empty disposable DB/schema.",
        `Current non-empty tables: ${populatedTables.map(([name, count]) => `${name}=${count}`).join(", ")}`,
        "Point DATABASE_URL to a disposable schema, or rerun with --allow-existing-data if this is intentional."
      ].join("\n")
    );
  }

  return counts;
}

function alertKey(alert: { ruleCode: string | null; type: string; title: string }) {
  return alert.ruleCode ?? `${alert.type}:${alert.title}`;
}

function compareAlerts(
  baselineItem: { openAlerts: Array<{ ruleCode: string | null; type: string; title: string }> } | undefined,
  combinedItem: { openAlerts: Array<{ ruleCode: string | null; type: string; title: string }> }
) {
  const baselineKeys = new Set((baselineItem?.openAlerts ?? []).map(alertKey));
  const combinedKeys = new Set(combinedItem.openAlerts.map(alertKey));

  return {
    resolved: Array.from(baselineKeys).filter((key) => !combinedKeys.has(key)).sort(),
    new: Array.from(combinedKeys).filter((key) => !baselineKeys.has(key)).sort()
  };
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
        rawLabel: evidence.rawLabel
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
  const databaseCountsBefore = await assertControlledDatabase();
  const pmPayload = buildPyloberPmPayload();
  const altasPayload = buildPyloberMaterialRequestsPayload();

  await importService.importPmRows(pmPayload);
  const baselineConsolidationSummary = await consolidationService.consolidatePendingImports();
  const baseline = await getProjectSnapshot(pyloberValidationProjectCode);

  await importService.importMaterialRequestRows(altasPayload);
  const combinedConsolidationSummary = await consolidationService.consolidatePendingImports();
  const combined = await getProjectSnapshot(pyloberValidationProjectCode);

  const baselineItemsBySlot = new Map(baseline.items.map((item) => [item.componentSlot, item]));
  const itemAlertDelta = combined.items.map((item) => ({
    itemKey: item.itemKey,
    componentSlot: item.componentSlot,
    ...compareAlerts(baselineItemsBySlot.get(item.componentSlot), item)
  }));
  const importedAltasRows = await prisma.importMaterialRequestRow.findMany({
    where: { batchId: altasPayload.batchId },
    orderBy: [{ rowNumber: "asc" }]
  });

  const report = {
    mode: "pm-plus-altas-controlled-consolidation",
    databaseCountsBefore,
    batches: {
      pm: pmPayload.batchId,
      altas: altasPayload.batchId
    },
    baseline: {
      consolidationSummary: baselineConsolidationSummary,
      ...baseline
    },
    combined: {
      consolidationSummary: combinedConsolidationSummary,
      ...combined
    },
    alertDelta: itemAlertDelta,
    importedAltasRows: importedAltasRows.map((row) => ({
      rowNumber: row.rowNumber,
      requestCode: row.requestCode,
      requestedDescription: row.requestedDescription,
      requestStatus: row.requestStatus,
      processingStatus: row.processingStatus,
      errorMessage: row.errorMessage
    }))
  };

  console.log(JSON.stringify(report, null, 2));

  const failedRows = importedAltasRows.filter((row) => row.processingStatus === ImportProcessStatus.ERROR);
  const duplicateSlots = combined.counts.duplicateSlots;

  if (failedRows.length > 0 || duplicateSlots.length > 0) {
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
