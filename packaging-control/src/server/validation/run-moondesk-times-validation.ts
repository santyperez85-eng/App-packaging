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
    "  npm run validate:moondesk-times -- <Tasks.xlsx> <Tasks_Times.xlsx> <Users_Tasks_Times.xlsx>",
    "",
    "Options:",
    "  --allow-existing-data  Run even when the current DB/schema is not empty."
  ].join("\n");
}

function getWorkbookPaths() {
  const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));

  if (positional.length !== 3) {
    throw new Error(`Expected 3 workbook paths (Tasks, Tasks_Times, Users_Tasks_Times).\n\n${usage()}`);
  }

  const resolved = positional.map((arg) => path.resolve(arg));

  for (const workbookPath of resolved) {
    if (!fs.existsSync(workbookPath)) {
      throw new Error(`Workbook not found: ${workbookPath}`);
    }
  }

  return { tasksPath: resolved[0], tasksTimesPath: resolved[1], usersTasksTimesPath: resolved[2] };
}

function isAllowExistingData() {
  return process.argv.includes("--allow-existing-data") || process.env.MOONDESK_ALLOW_EXISTING_DATA === "1";
}

async function assertControlledDatabase() {
  const counts = {
    projects: await prisma.project.count(),
    projectItems: await prisma.projectItem.count(),
    moondeskTasks: await prisma.moondeskTask.count(),
    moondeskReviews: await prisma.moondeskReview.count()
  };
  const populated = Object.entries(counts).filter(([, count]) => count > 0);

  if (populated.length > 0 && !isAllowExistingData()) {
    throw new Error(
      [
        "Moondesk times validation expects an empty disposable DB/schema.",
        `Current non-empty tables: ${populated.map(([name, count]) => `${name}=${count}`).join(", ")}`,
        "Point DATABASE_URL to a disposable schema, or rerun with --allow-existing-data if intentional."
      ].join("\n")
    );
  }

  return counts;
}

async function main() {
  const { tasksPath, tasksTimesPath, usersTasksTimesPath } = getWorkbookPaths();
  const databaseCountsBefore = await assertControlledDatabase();

  await importService.importPmRows(buildPyloberPmPayload());
  await consolidationService.consolidatePendingImports();
  await importService.importMaterialRequestRows(buildPyloberMaterialRequestsPayload());
  await consolidationService.consolidatePendingImports();

  await moondeskReportService.applyReport({
    workbookPath: tasksPath,
    projectCode: pyloberValidationProjectCode,
    projectToken: "PYLOBER"
  });

  const times = await moondeskReportService.applyTimesReports({
    projectCode: pyloberValidationProjectCode,
    tasksTimesWorkbookPath: tasksTimesPath,
    usersTasksTimesWorkbookPath: usersTasksTimesPath
  });

  // Reimportar los Times debe ser idempotente (no duplica reviews).
  const timesRerun = await moondeskReportService.applyTimesReports({
    projectCode: pyloberValidationProjectCode,
    tasksTimesWorkbookPath: tasksTimesPath,
    usersTasksTimesWorkbookPath: usersTasksTimesPath
  });

  const estuche = await prisma.projectItem.findFirst({
    where: { project: { code: pyloberValidationProjectCode }, componentSlot: "ESTUCHE" }
  });

  if (!estuche) {
    throw new Error("PYLOBER ESTUCHE not found");
  }

  const lifecycle = await projectItemLifecycleService.getProjectItemLifecycle(estuche.id);
  const reviewsTotal = await prisma.moondeskReview.count();

  const report = {
    mode: "moondesk-times-validation",
    databaseCountsBefore,
    times,
    timesRerun,
    reviewsTotal,
    estucheDocumentation: lifecycle.documentation
  };

  console.log(JSON.stringify(report, null, 2));

  const doc = lifecycle.documentation;
  const hasReviews = Boolean(doc && doc.reviews.length > 0);
  const hasMetrics = Boolean(doc && (doc.metrics.reviewDays !== null || doc.metrics.reprocessCount !== null));
  const idempotent = times.reviewsUpserted === timesRerun.reviewsUpserted && reviewsTotal === times.reviewsUpserted;

  if (times.tasksEnriched === 0 || !hasReviews || !hasMetrics || !idempotent) {
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
