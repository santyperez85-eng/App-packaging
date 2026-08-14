import { prisma } from "@/lib/prisma";
import { dashboardService } from "@/server/services/dashboard-service";
import { pmFolderImportService } from "@/server/services/pm-folder-import-service";

function usage() {
  return [
    "Usage:",
    "  npm run import:pm-folder -- [/path/to/Información Base Moléculas] [options]",
    "",
    "Sin ruta usa PM_SOURCE_DIR.",
    "",
    "Options:",
    "  --dry-run            Solo descubrir y listar candidatos, sin importar.",
    "  --limit=N            Procesar como maximo N planillas.",
    "  --product=TEXTO      Filtrar por producto (repetible, match parcial).",
    "  --force              Reimportar proyectos que ya existen."
  ].join("\n");
}

function parseArgs() {
  const args = process.argv.slice(2);
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const products = args.filter((arg) => arg.startsWith("--product=")).map((arg) => arg.slice("--product=".length));

  if (args.includes("--help")) {
    throw new Error(usage());
  }

  return {
    rootDir: positional[0],
    dryRun: args.includes("--dry-run"),
    force: args.includes("--force"),
    limit: limitArg ? Number(limitArg.slice("--limit=".length)) : undefined,
    products: products.length ? products : undefined
  };
}

async function main() {
  const options = parseArgs();

  if (options.dryRun) {
    const { discoverPmWorkbooks, resolvePmSourceDir } = await import("@/server/etl/pm-source-folder");
    const discovery = discoverPmWorkbooks(resolvePmSourceDir(options.rootDir));

    console.log(
      JSON.stringify(
        {
          mode: "pm-folder-discovery-dry-run",
          rootDir: discovery.rootDir,
          foldersScanned: discovery.foldersScanned,
          filesScanned: discovery.filesScanned,
          candidateCount: discovery.candidates.length,
          candidates: discovery.candidates.map((candidate) => ({
            productFolder: candidate.productFolder,
            fileName: candidate.fileName,
            modifiedAt: candidate.modifiedAt.toISOString(),
            sizeBytes: candidate.sizeBytes
          })),
          ignored: discovery.ignored
        },
        null,
        2
      )
    );

    return;
  }

  const result = await pmFolderImportService.importFromFolder({
    rootDir: options.rootDir,
    limit: options.limit,
    products: options.products,
    force: options.force
  });
  const pipeline = await dashboardService.getPipelineSnapshot();
  const projects = await prisma.project.count();
  const items = await prisma.projectItem.count();

  console.log(
    JSON.stringify(
      {
        mode: "pm-folder-import",
        ...result,
        afterImport: {
          projects,
          projectItems: items,
          pipeline: pipeline.stages.map((stage) => ({
            key: stage.key,
            coveragePercent: stage.coveragePercent,
            ready: stage.ready,
            partial: stage.partial,
            missing: stage.missing,
            notApplicable: stage.notApplicable
          }))
        }
      },
      null,
      2
    )
  );

  if (result.summary.imported === 0 && result.summary.skippedExisting === 0) {
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
