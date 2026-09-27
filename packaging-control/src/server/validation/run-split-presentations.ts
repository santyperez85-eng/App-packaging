import { prisma } from "@/lib/prisma";
import { presentationSplitService } from "@/server/services/presentation-split-service";

/**
 * Separa las presentaciones que compartian un mismo componente.
 *
 *   npm run split:presentaciones -- --dry-run
 *   npm run split:presentaciones
 */
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const plan = await presentationSplitService.getPlan();

  const conSeparacion = plan.filter((entry) => entry.splitsInto.length);
  const ajenos = plan.flatMap((entry) => entry.belongsElsewhere.map((o) => ({ ...o, desde: entry.projectCode })));
  const soloVersiones = plan.filter((entry) => !entry.splitsInto.length);

  console.log(dryRun ? "SIMULACION (no se modifica nada)" : "SEPARACION DE PRESENTACIONES");
  console.log("=".repeat(52));
  console.log(`componentes con varias presentaciones : ${conSeparacion.length}`);
  console.log(`componentes nuevos que se crearian    : ${conSeparacion.reduce((total, entry) => total + entry.splitsInto.length, 0)}`);
  console.log(`componentes con solo versiones        : ${soloVersiones.length} (se resuelven solos, no son decision)`);
  console.log(`codigos que son de otro producto      : ${ajenos.length} (no se separan)`);
  for (const a of ajenos) {
    console.log(`    ${a.desde} <- ${a.code} ${a.description ?? ""} -> ${a.projectCode}`);
  }

  if (conSeparacion.length) {
    console.log("\nSE SEPARAN:");
    for (const entry of conSeparacion) {
      console.log(`\n  ${entry.projectCode} / ${entry.itemName}`);
      console.log(`    se queda con : ${entry.keeps}`);
      for (const split of entry.splitsInto) {
        console.log(`    componente nuevo: ${split.code.padEnd(9)} ${split.description ?? ""}`);
      }
      for (const sup of entry.superseded) {
        console.log(`    version vigente ${sup.current} reemplaza a ${sup.older.join(", ")}`);
      }
      for (const otro of entry.belongsElsewhere) {
        console.log(`    NO se separa: ${otro.code} ${otro.description ?? ""} -> es de ${otro.projectCode}`);
      }
    }
  }

  if (soloVersiones.length) {
    console.log("\nSOLO VERSIONES (la mas nueva reemplaza, sin preguntar):");
    for (const entry of soloVersiones) {
      for (const sup of entry.superseded) {
        console.log(`  ${entry.projectCode} / ${entry.itemName}: ${sup.current} reemplaza a ${sup.older.join(", ")}`);
      }
    }
  }

  if (dryRun) {
    console.log("\nCorrer sin --dry-run para aplicar.");
    return;
  }

  const result = await presentationSplitService.apply();
  console.log(`\nlisto: ${result.createdItems} componentes creados, ${result.movedEvidences} evidencias movidas, ${result.relinked} componentes revinculados.`);

  const { projectItemsService } = await import("@/server/services/project-items-service");
  const items = await prisma.projectItem.findMany({ select: { id: true } });
  for (const item of items) {
    await projectItemsService.recalculateProjectItem(item.id);
  }
  console.log(`recalculados ${items.length} componentes.`);
}

main()
  .catch((error) => {
    console.error("FALLO:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
