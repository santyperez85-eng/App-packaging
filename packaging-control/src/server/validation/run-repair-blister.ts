import {
  ApplicabilityStatus,
  ComponentSlot,
  ProjectItemExpectedStatus,
  ProjectItemIdentificationStatus,
  ProjectItemOriginMode
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Reinterpreta los componentes "Blister" ya cargados.
 *
 * "Blister: SI" en el PM declara el **formato** -dice que no es frasco ni
 * pomo-, no un componente. Los componentes reales son siempre dos: el aluminio
 * foil de tapa y la lamina que forma el blister, que puede ser PVC de cualquier
 * tipo o aluminio moldeable en frio.
 *
 * El componente existente no se borra: **es** esa lamina, solo estaba mal
 * nombrado. Y se agrega el aluminio foil donde falta, porque esta en las dos
 * variantes. El material de la lamina no se adivina: queda visible para
 * resolverlo con el alta o la receta, o a mano, porque muchas veces se asigna
 * un PVC que ya existe en vez de pedir uno nuevo.
 *
 *   npm run repair:blister -- --dry-run
 *   npm run repair:blister
 */

const NEW_BLISTER_LABEL = "Lámina del blíster";
const ALUMINIUM_LABEL = "Aluminio foil";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const allBlisters = await prisma.projectItem.findMany({
    where: { componentSlot: ComponentSlot.BLISTER },
    include: { project: true, evidences: true, materialRequest: true, materialMaster: true }
  });

  /**
   * Blisters que nacieron de la grilla comercial (`pm_matrix_structured_quantity`)
   * y no tienen ninguna evidencia propia: son un volumen de ventas leido como
   * formato. Un jarabe de 250 ml no lleva blister.
   *
   * Solo se borran los que no tienen nada colgando: si alguno junto un alta o
   * un codigo de SAP, el dato real manda sobre la sospecha y se conserva.
   */
  const falsePositives = allBlisters.filter((item) => {
    const pmEvidences = item.evidences.filter((evidence) => evidence.sourceType === "pm_expected");
    const onlyFromQuantity =
      pmEvidences.length > 0 &&
      pmEvidences.every((evidence) => {
        const raw = (evidence.rawData ?? {}) as { definitionRule?: string };
        return raw.definitionRule === "pm_matrix_structured_quantity";
      });

    const hasRealEvidence =
      Boolean(item.materialRequest) ||
      Boolean(item.materialMaster) ||
      Boolean(item.expectedMaterialCode) ||
      item.evidences.some((evidence) => evidence.sourceType !== "pm_expected");

    return onlyFromQuantity && !hasRealEvidence;
  });

  const falseIds = new Set(falsePositives.map((item) => item.id));
  const blisters = allBlisters.filter((item) => !falseIds.has(item.id));

  const projectIds = [...new Set(blisters.map((item) => item.projectId))];
  const aluminium = await prisma.projectItem.findMany({
    where: { projectId: { in: projectIds }, componentSlot: ComponentSlot.ALUMINIO },
    select: { projectId: true }
  });
  const projectsWithAluminium = new Set(aluminium.map((item) => item.projectId));

  // Solo se renombran los que conservan el nombre generico. Si alguien (o el
  // PM) puso una descripcion propia, se respeta.
  const toRename = blisters.filter((item) => /^blister$/i.test(item.name.trim()));
  const needAluminium = blisters.filter((item) => !projectsWithAluminium.has(item.projectId));

  console.log(dryRun ? "SIMULACION (no se modifica nada)" : "REINTERPRETACION DEL BLISTER");
  console.log("=".repeat(50));
  console.log(`componentes blister                 : ${allBlisters.length}`);
  console.log(`  falsos (volumen comercial), se borran: ${falsePositives.length}`);
  for (const item of falsePositives) {
    console.log(`      ${item.project.code}`);
  }
  console.log(`  blisters reales                   : ${blisters.length}`);
  console.log(`  se renombran a "${NEW_BLISTER_LABEL}" : ${toRename.length}`);
  console.log(`  conservan su nombre propio        : ${blisters.length - toRename.length}`);
  console.log(`proyectos con blister               : ${projectIds.length}`);
  console.log(`  ya tienen aluminio                : ${projectsWithAluminium.size}`);
  console.log(`  se les agrega "${ALUMINIUM_LABEL}"      : ${new Set(needAluminium.map((i) => i.projectId)).size}`);

  if (needAluminium.length) {
    console.log("\nSE AGREGA ALUMINIO FOIL A:");
    for (const item of needAluminium) {
      console.log(`  ${item.project.code}`);
    }
  }

  if (dryRun) {
    console.log("\nCorrer sin --dry-run para aplicar.");
    return;
  }

  await prisma.projectItemEvidence.deleteMany({ where: { projectItemId: { in: [...falseIds] } } });
  await prisma.alert.deleteMany({ where: { projectItemId: { in: [...falseIds] } } });
  await prisma.projectItem.deleteMany({ where: { id: { in: [...falseIds] } } });

  for (const item of toRename) {
    await prisma.projectItem.update({ where: { id: item.id }, data: { name: NEW_BLISTER_LABEL } });
  }

  let created = 0;
  for (const item of needAluminium) {
    const itemKey = "ALUMINIO";
    const existing = await prisma.projectItem.findFirst({
      where: { projectId: item.projectId, itemKey }
    });

    if (existing) {
      continue;
    }

    await prisma.projectItem.create({
      data: {
        projectId: item.projectId,
        itemKey,
        name: ALUMINIUM_LABEL,
        componentSlot: ComponentSlot.ALUMINIO,
        applicabilityStatus: ApplicabilityStatus.APPLIES,
        originMode: ProjectItemOriginMode.PM_EXPECTED,
        expectedStatus: ProjectItemExpectedStatus.EXPECTED,
        identificationStatus: ProjectItemIdentificationStatus.NOT_IDENTIFIED,
        requiresApprovedDocument: false,
        requiresMaterialCode: true,
        requiresTechnicalDocs: true
      }
    });
    created += 1;
  }

  console.log(`\nlisto: ${falsePositives.length} falsos borrados, ${toRename.length} renombrados, ${created} componentes de aluminio creados.`);

  const { projectItemsService } = await import("@/server/services/project-items-service");
  const all = await prisma.projectItem.findMany({ select: { id: true } });
  for (const entry of all) {
    await projectItemsService.recalculateProjectItem(entry.id);
  }
  console.log(`recalculados ${all.length} componentes.`);
}

main()
  .catch((error) => {
    console.error("FALLO:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
