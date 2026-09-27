import { prisma } from "@/lib/prisma";
import { derivePrintRequirement } from "@/server/rules/printed-component";

/**
 * Recalcula si cada componente lleva arte, usando la mejor descripcion
 * disponible: la del alta o la del maestro antes que la etiqueta generica del
 * PM. Solo escribe cuando la deduccion es concluyente.
 *
 *   npm run repair:arte -- --dry-run
 *   npm run repair:arte
 */
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const items = await prisma.projectItem.findMany({
    include: { project: true, materialRequest: true, materialMaster: true }
  });

  const cambios: Array<{ code: string; name: string; de: boolean; a: boolean; motivo: string }> = [];

  for (const item of items) {
    const description =
      item.materialRequest?.requestedDescription ?? item.materialMaster?.description ?? item.description ?? item.name;
    const materialCode = item.materialMaster?.materialCode ?? item.expectedMaterialCode ?? undefined;
    const print = derivePrintRequirement({ componentSlot: item.componentSlot, description, materialCode });

    if (!print.confident || print.requiresArt === item.requiresApprovedDocument) {
      continue;
    }

    cambios.push({
      code: item.project.code,
      name: item.name,
      de: item.requiresApprovedDocument,
      a: print.requiresArt,
      motivo: print.reason
    });

    if (!dryRun) {
      await prisma.projectItem.update({
        where: { id: item.id },
        data: { requiresApprovedDocument: print.requiresArt }
      });
    }
  }

  console.log(dryRun ? "SIMULACION (no se modifica nada)" : "RECALCULO DE ARTE");
  console.log("=".repeat(46));
  console.log(`componentes revisados : ${items.length}`);
  console.log(`cambian              : ${cambios.length}`);
  console.log(`  pasan a NO llevar arte: ${cambios.filter((c) => !c.a).length}`);
  console.log(`  pasan a SI llevar arte: ${cambios.filter((c) => c.a).length}\n`);

  for (const c of cambios) {
    console.log(`  ${c.a ? "SI" : "NO"}  ${c.code.padEnd(42).slice(0, 42)} ${c.name.slice(0, 40)}`);
    console.log(`      ${c.motivo}`);
  }

  if (dryRun) {
    console.log("\nCorrer sin --dry-run para aplicar.");
    return;
  }

  const { projectItemsService } = await import("@/server/services/project-items-service");
  for (const item of items) {
    await projectItemsService.recalculateProjectItem(item.id);
  }
  console.log(`\nrecalculados ${items.length} componentes.`);
}

main()
  .catch((error) => {
    console.error("FALLO:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
