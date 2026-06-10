import fs from "node:fs";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { readPmSheetsFromRequest } from "@/server/etl/excel";
import { consolidationService } from "@/server/etl/consolidation-service";
import { importService } from "@/server/etl/import-service";
import { buildAltaMatMaterialRequestImportPayload } from "@/server/etl/alta-mat-material-requests";
import { buildRecetasBomImportPayload } from "@/server/etl/recetas-bom-phase1";
import { projectItemLifecycleService } from "@/server/services/project-item-lifecycle-service";

type FullCycleCase = {
  key: string;
  label: string;
  pmWorkbookPath: string;
  altaProjectToken: string;
  bomProjectToken: string;
};

function usage() {
  return [
    "Usage:",
    "  npm run validate:full-cycle -- \\",
    "    /path/creatina-pm.xlsx /path/perpiel-jabon-pm.xlsx /path/perpiel-spray-pm.xlsx /path/magnesio-pm.xlsx \\",
    "    /path/recetas.xlsx /path/alta-de-mat.xlsx",
    "",
    "Options:",
    "  --allow-existing-data  Run even when the current DB/schema is not empty."
  ].join("\n");
}

function getWorkbookPaths() {
  const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));

  if (positionalArgs.length !== 6) {
    throw new Error(`Expected 6 workbook paths, received ${positionalArgs.length}.\n\n${usage()}`);
  }

  const [creatinaPm, jabonPm, sprayPm, magnesioPm, recetas, altas] = positionalArgs.map((arg) => path.resolve(arg));

  for (const workbookPath of [creatinaPm, jabonPm, sprayPm, magnesioPm, recetas, altas]) {
    if (!fs.existsSync(workbookPath)) {
      throw new Error(`Workbook not found: ${workbookPath}`);
    }
  }

  return { creatinaPm, jabonPm, sprayPm, magnesioPm, recetas, altas };
}

function isAllowExistingData() {
  return process.argv.includes("--allow-existing-data") || process.env.FULL_CYCLE_ALLOW_EXISTING_DATA === "1";
}

async function assertControlledDatabase() {
  const counts = {
    products: await prisma.product.count(),
    projects: await prisma.project.count(),
    projectItems: await prisma.projectItem.count(),
    projectItemEvidences: await prisma.projectItemEvidence.count(),
    alerts: await prisma.alert.count(),
    pmRows: await prisma.importPmRow.count(),
    materialRequestRows: await prisma.importMaterialRequestRow.count(),
    bomRows: await prisma.importBomRow.count(),
    materialRequests: await prisma.materialRequest.count(),
    bomItems: await prisma.bomItem.count()
  };
  const populatedTables = Object.entries(counts).filter(([, count]) => count > 0);

  if (populatedTables.length > 0 && !isAllowExistingData()) {
    throw new Error(
      [
        "Full cycle validation expects an empty disposable DB/schema.",
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

async function getProjectItems(projectCode: string) {
  return prisma.projectItem.findMany({
    where: { project: { code: projectCode } },
    include: {
      materialRequest: true,
      evidences: true,
      alerts: { where: { status: "OPEN" } }
    },
    orderBy: [{ componentSlot: "asc" }, { itemKey: "asc" }]
  });
}

async function runCase(params: {
  caseConfig: FullCycleCase;
  recetasWorkbookPath: string;
  altasWorkbookPath: string;
}) {
  const { caseConfig } = params;

  const pmPayload = await readPmWorkbook(caseConfig.pmWorkbookPath);
  await importService.importPmRows(pmPayload);
  const pmSummary = await consolidationService.consolidatePendingImports();
  const projectCode = await getImportedPmProjectCode(pmPayload.batchId);
  const pmItems = await getProjectItems(projectCode);
  const expectedComponentSlots = pmItems.map((item) => item.componentSlot);

  const altas = buildAltaMatMaterialRequestImportPayload({
    workbookPath: params.altasWorkbookPath,
    projectCode,
    projectToken: caseConfig.altaProjectToken,
    expectedComponentSlots
  });
  await importService.importMaterialRequestRows(altas.payload);
  const altasSummary = await consolidationService.consolidatePendingImports();

  const bom = buildRecetasBomImportPayload({
    workbookPath: params.recetasWorkbookPath,
    projectCode,
    projectToken: caseConfig.bomProjectToken,
    expectedComponentSlots
  });
  await importService.importBomRows(bom.payload);
  const bomSummary = await consolidationService.consolidatePendingImports();

  const finalItems = await getProjectItems(projectCode);
  const lifecycles = [] as Array<{
    itemKey: string;
    componentSlot: string;
    milestones: Array<{ key: string; status: string }>;
    openAlerts: string[];
    reconstructionGaps: number;
  }>;

  for (const item of finalItems) {
    const lifecycle = await projectItemLifecycleService.getProjectItemLifecycle(item.id);

    lifecycles.push({
      itemKey: item.itemKey,
      componentSlot: String(item.componentSlot),
      milestones: lifecycle.milestones.map((milestone) => ({ key: milestone.key, status: milestone.status })),
      openAlerts: lifecycle.alerts
        .filter((alert) => alert.status === "OPEN")
        .map((alert) => alert.ruleCode ?? alert.type),
      reconstructionGaps: lifecycle.reconstructionGaps.length
    });
  }

  const slotCounts = finalItems.reduce<Record<string, number>>((acc, item) => {
    const slot = String(item.componentSlot);
    acc[slot] = (acc[slot] ?? 0) + 1;
    return acc;
  }, {});

  return {
    key: caseConfig.key,
    label: caseConfig.label,
    projectCode,
    tokens: {
      altas: caseConfig.altaProjectToken,
      bom: caseConfig.bomProjectToken
    },
    pm: {
      summary: pmSummary,
      itemsCreated: pmItems.map((item) => ({ itemKey: item.itemKey, componentSlot: item.componentSlot }))
    },
    altas: {
      candidates: altas.diagnostics.candidates.length,
      candidateDetails: altas.diagnostics.candidates.map((candidate) => ({
        excelRow: candidate.excelRow,
        componentSlot: candidate.componentSlot,
        requestCode: candidate.requestCode,
        requestedDescription: candidate.requestedDescription,
        contextMatch: candidate.contextMatch,
        confidence: candidate.confidence
      })),
      ignoredByReason: altas.diagnostics.ignoredByReason,
      summary: altasSummary
    },
    bom: {
      candidateBlocks: bom.diagnostics.candidateBlocks,
      summary: bomSummary
    },
    duplicateSlots: Object.entries(slotCounts)
      .filter(([, count]) => count > 1)
      .map(([componentSlot, count]) => ({ componentSlot, count })),
    items: finalItems.map((item) => ({
      itemKey: item.itemKey,
      componentSlot: item.componentSlot,
      status: item.status,
      matchingStatus: item.matchingStatus,
      readinessScore: item.readinessScore,
      materialRequestCode: item.materialRequest?.requestCode ?? null,
      evidences: item.evidences.map((evidence) => `${evidence.sourceType}:${evidence.sourceRecordKey}`),
      openAlerts: item.alerts.map((alert) => alert.ruleCode ?? alert.type)
    })),
    lifecycles
  };
}

function lifecycleMilestone(
  caseReport: Awaited<ReturnType<typeof runCase>>,
  componentSlot: string,
  milestoneKey: string
) {
  const lifecycle = caseReport.lifecycles.find((entry) => entry.componentSlot === componentSlot);

  return lifecycle?.milestones.find((milestone) => milestone.key === milestoneKey)?.status ?? null;
}

async function main() {
  const paths = getWorkbookPaths();
  const databaseCountsBefore = await assertControlledDatabase();

  const cases: FullCycleCase[] = [
    {
      key: "creatina",
      label: "Bernabio Creatina x 300 gr",
      pmWorkbookPath: paths.creatinaPm,
      altaProjectToken: "CREATINA",
      bomProjectToken: "BERNABIO CREATINA"
    },
    {
      key: "perpielJabon",
      label: "PerPiel Heridas Jabon x 250 ml",
      pmWorkbookPath: paths.jabonPm,
      altaProjectToken: "PERPIEL HERIDAS JABON",
      bomProjectToken: "PERPIEL HERIDAS JABON"
    },
    {
      key: "perpielSpray",
      label: "PerPiel Heridas Spray x 40 ml",
      pmWorkbookPath: paths.sprayPm,
      altaProjectToken: "PERPIEL HERIDAS X 40 ML",
      bomProjectToken: "PERPIEL HERIDAS X 40 ML"
    },
    {
      key: "magnesio",
      label: "Bernabo+ Magnesio en Polvo x 150 gr",
      pmWorkbookPath: paths.magnesioPm,
      altaProjectToken: "BERNABO+ MAGNESIO",
      bomProjectToken: "MAGNESIO EN POLVO X 150G"
    }
  ];

  const reports = [] as Array<Awaited<ReturnType<typeof runCase>>>;

  for (const caseConfig of cases) {
    reports.push(
      await runCase({
        caseConfig,
        recetasWorkbookPath: paths.recetas,
        altasWorkbookPath: paths.altas
      })
    );
  }

  const report = {
    mode: "full-cycle-pm-altas-bom-validation",
    databaseCountsBefore,
    cases: reports
  };

  console.log(JSON.stringify(report, null, 2));

  const byKey = Object.fromEntries(reports.map((entry) => [entry.key, entry]));
  const hasDuplicateSlots = reports.some((entry) => entry.duplicateSlots.length > 0);
  const magnesioAmbiguityPreserved =
    byKey.magnesio.bom.candidateBlocks.length === 2 &&
    lifecycleMilestone(byKey.magnesio, "FRASCO", "pre_sap_structure") === "missing";
  const sprayStructureEvidenced = lifecycleMilestone(byKey.perpielSpray, "FRASCO", "pre_sap_structure") !== "missing";
  const jabonStructureEvidenced = lifecycleMilestone(byKey.perpielJabon, "FRASCO", "pre_sap_structure") !== "missing";

  if (hasDuplicateSlots || !magnesioAmbiguityPreserved || !sprayStructureEvidenced || !jabonStructureEvidenced) {
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
