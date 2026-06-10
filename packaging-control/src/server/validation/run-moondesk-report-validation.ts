import fs from "node:fs";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { consolidationService } from "@/server/etl/consolidation-service";
import { importService } from "@/server/etl/import-service";
import { moondeskReportService } from "@/server/services/moondesk-report-service";
import { projectItemLifecycleService } from "@/server/services/project-item-lifecycle-service";
import {
  buildPyloberMaterialRequestsPayload,
  buildPyloberPmPayload,
  pyloberValidationProjectCode
} from "@/server/validation/pm-material-request-validation-fixture";

function usage() {
  return [
    "Usage:",
    "  npm run validate:moondesk -- /absolute/path/to/Tasks_Laboratorios.xlsx",
    "",
    "Options:",
    "  --allow-existing-data  Run even when the current DB/schema is not empty."
  ].join("\n");
}

function getWorkbookPath() {
  const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const workbookPath = positional[0] ?? process.env.MOONDESK_TASKS_WORKBOOK;

  if (!workbookPath) {
    throw new Error(`Moondesk tasks workbook path is required.\n\n${usage()}`);
  }

  const resolved = path.resolve(workbookPath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Workbook not found: ${resolved}`);
  }

  return resolved;
}

function isAllowExistingData() {
  return process.argv.includes("--allow-existing-data") || process.env.MOONDESK_ALLOW_EXISTING_DATA === "1";
}

async function assertControlledDatabase() {
  const counts = {
    projects: await prisma.project.count(),
    projectItems: await prisma.projectItem.count(),
    moondeskTasks: await prisma.moondeskTask.count(),
    alerts: await prisma.alert.count()
  };
  const populated = Object.entries(counts).filter(([, count]) => count > 0);

  if (populated.length > 0 && !isAllowExistingData()) {
    throw new Error(
      [
        "Moondesk report validation expects an empty disposable DB/schema.",
        `Current non-empty tables: ${populated.map(([name, count]) => `${name}=${count}`).join(", ")}`,
        "Point DATABASE_URL to a disposable schema, or rerun with --allow-existing-data if intentional."
      ].join("\n")
    );
  }

  return counts;
}

function milestoneStatus(
  lifecycle: Awaited<ReturnType<typeof projectItemLifecycleService.getProjectItemLifecycle>>,
  key: string
) {
  return lifecycle.milestones.find((milestone) => milestone.key === key)?.status ?? null;
}

function hasOpenAlert(
  lifecycle: Awaited<ReturnType<typeof projectItemLifecycleService.getProjectItemLifecycle>>,
  ruleCode: string
) {
  return lifecycle.alerts.some((alert) => alert.status === "OPEN" && alert.ruleCode === ruleCode);
}

async function main() {
  const workbookPath = getWorkbookPath();
  const databaseCountsBefore = await assertControlledDatabase();

  // Caso PYLOBER: PM + Altas (con codigos reales) ya validados; Moondesk como ultima capa.
  await importService.importPmRows(buildPyloberPmPayload());
  await consolidationService.consolidatePendingImports();
  await importService.importMaterialRequestRows(buildPyloberMaterialRequestsPayload());
  await consolidationService.consolidatePendingImports();

  const moondesk = await moondeskReportService.applyReport({
    workbookPath,
    projectCode: pyloberValidationProjectCode,
    projectToken: "PYLOBER"
  });

  const items = await prisma.projectItem.findMany({
    where: { project: { code: pyloberValidationProjectCode } },
    orderBy: [{ componentSlot: "asc" }]
  });

  const lifecycles: Record<string, Awaited<ReturnType<typeof projectItemLifecycleService.getProjectItemLifecycle>>> = {};
  for (const item of items) {
    lifecycles[String(item.componentSlot)] = await projectItemLifecycleService.getProjectItemLifecycle(item.id);
  }

  const report = {
    mode: "moondesk-report-validation",
    databaseCountsBefore,
    moondesk: {
      itemsTouched: moondesk.itemsTouched,
      applied: moondesk.applied,
      diagnostics: {
        rowsParsed: moondesk.diagnostics.rowsParsed,
        projectRows: moondesk.diagnostics.projectRows,
        packagingCandidates: moondesk.diagnostics.packagingCandidates,
        ignoredByReason: moondesk.diagnostics.ignoredByReason,
        candidates: moondesk.diagnostics.candidates
      }
    },
    items: items.map((item) => {
      const lifecycle = lifecycles[String(item.componentSlot)];

      return {
        itemKey: item.itemKey,
        componentSlot: item.componentSlot,
        readinessScore: item.readinessScore,
        status: item.status,
        documentationApproval: milestoneStatus(lifecycle, "documentation_approval"),
        approvedDocumentMissing: hasOpenAlert(lifecycle, "APPROVED_DOCUMENT_MISSING")
      };
    })
  };

  console.log(JSON.stringify(report, null, 2));

  // Las filas Moondesk de PYLOBER (Estuche, Prospecto, Aluminio) estan aprobadas:
  // esos slots deben quedar con documentation_approval=ready y sin APPROVED_DOCUMENT_MISSING.
  const approvedSlots = ["ESTUCHE", "PROSPECTO", "ALUMINIO"];
  const allApprovedReady = approvedSlots.every((slot) => {
    const lifecycle = lifecycles[slot];

    return lifecycle && milestoneStatus(lifecycle, "documentation_approval") === "ready" && !hasOpenAlert(lifecycle, "APPROVED_DOCUMENT_MISSING");
  });

  if (moondesk.itemsTouched === 0 || !allApprovedReady) {
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
