import { prisma } from "@/lib/prisma";
import { normalizeText } from "@/lib/utils";
import { descriptionProductKey } from "@/server/etl/alta-mat-material-requests";
import { resolveProjectTokens } from "@/server/etl/project-token-resolver";

/**
 * Limpia las altas que quedaron vinculadas al proyecto equivocado.
 *
 * El arrastre de contexto de `detectContextRows` usaba la firma
 * motivo+solicitante+fecha para continuar un bloque de pedidos, pero esa firma
 * identifica una **tanda**, no un producto: en la planilla real una misma
 * persona pide el mismo dia estuches de productos distintos. Resultado: el 48%
 * de las altas vinculadas hablaban de otro producto (`EST.ALIPAS DUO` colgado
 * de Dexogastec, `PROSP.VORST 36` de Dapaber).
 *
 * El adaptador ya no lo reintroduce. Esto repara lo que quedo cargado.
 *
 *   npm run repair:altas -- --dry-run     muestra que haria
 *   npm run repair:altas                  aplica
 */

/**
 * Palabras que describen el **material**, no el producto. Una descripcion como
 * `FCO.PET VERDE x 30 ml` o `P.V.C ACLAR 160/42 CRISTAL` no nombra ningun
 * producto: son justamente los componentes que se piden sin nombre propio
 * porque no llevan impresion. No alcanzan para desvincular nada.
 */
const GENERIC_MATERIAL_WORDS = new Set([
  "pet",
  "pvc",
  "aclar",
  "cristal",
  "polietileno",
  "poliestireno",
  "aluminio",
  "alum",
  "carton",
  "papel",
  "verde",
  "blanco",
  "negro",
  "ambar",
  "transparente",
  "natural",
  "incoloro",
  "termocontraible",
  "generico",
  "standard",
  "estandar"
]);

function norm(value: string | null | undefined) {
  return normalizeText(value ?? "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Clave de producto del proyecto, para comparar contra la de cada alta. */
function projectProductKey(productName: string) {
  return descriptionProductKey(productName) ?? norm(productName).split(" ")[0] ?? null;
}

/**
 * Un alta pertenece al proyecto si lo nombra de alguna de las formas validas.
 *
 * Desvincular de mas es peor que de menos: borrar un vinculo correcto hace que
 * un componente pase a "falta el codigo" cuando en realidad se pidio. Por eso
 * alcanza con **cualquiera** de estas senales para dejarlo donde esta:
 *
 *  - el token del proyecto (el del resolutor, que incluye las excepciones:
 *    `PM-DESINFECTANTE-40-ML` se nombra "PERPIEL HERIDAS" en las altas);
 *  - la palabra identificatoria del producto en cualquier parte del texto
 *    (`FCO.BERNABO+ MAGNESIO X 150G` nombra la marca primero, pero dice
 *    "magnesio");
 *  - que la descripcion no nombre ningun producto.
 */
function belongsToProject(
  description: string,
  context: { token: string; key: string | null }
) {
  const text = norm(description);

  if (!text) {
    return true; // Sin descripcion no hay con que contradecir: no se toca.
  }

  const padded = ` ${text} `;

  if (context.token && padded.includes(` ${context.token} `)) {
    return true;
  }

  if (context.key && padded.includes(` ${context.key} `)) {
    return true;
  }

  const key = descriptionProductKey(description);

  return !key || GENERIC_MATERIAL_WORDS.has(key);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const projects = await prisma.project.findMany({ include: { product: true } });
  // Mismo resolutor que usa la importacion: trae las excepciones ya resueltas.
  const specs = new Map(
    resolveProjectTokens(
      projects.map((project) => ({ code: project.code, productName: project.product?.name ?? project.name }))
    ).map((spec) => [spec.projectCode, spec])
  );
  const context = new Map(
    projects.map((project) => {
      const productName = (project.product?.name ?? project.name).split("(")[0].trim();
      const spec = specs.get(project.code);
      return [
        project.id,
        { token: norm(spec?.token ?? productName), key: projectProductKey(productName), code: project.code }
      ];
    })
  );

  const evidences = await prisma.projectItemEvidence.findMany({
    where: { sourceType: "material_request" },
    include: { projectItem: { include: { project: true } } }
  });

  const badEvidences = evidences.filter((evidence) => {
    const ctx = context.get(evidence.projectItem.projectId);
    return ctx && !belongsToProject(evidence.rawLabel ?? "", ctx);
  });

  const requests = await prisma.materialRequest.findMany({ include: { project: true } });
  const badRequests = requests.filter((request) => {
    const ctx = context.get(request.projectId);
    return ctx && !belongsToProject(request.requestedDescription, ctx);
  });

  const items = await prisma.projectItem.findMany({
    include: { materialRequest: true, materialMaster: true, project: true }
  });
  const badLinks = items.filter((item) => {
    if (!item.materialRequest) return false;
    const ctx = context.get(item.projectId);
    return ctx && !belongsToProject(item.materialRequest.requestedDescription, ctx);
  });

  /**
   * El alta contaminada arrastraba consigo el vinculo al material de SAP, que
   * sobrevive aunque se borre el alta. Es el que hacia que Dexogastec figurara
   * con el material S237/70 (que es de Alipas Duo) y disparaba el aviso de
   * discontinuado sobre el producto equivocado.
   */
  const badMaterialLinks = items.filter((item) => {
    if (!item.materialMaster) return false;
    const ctx = context.get(item.projectId);
    return ctx && !belongsToProject(item.materialMaster.description ?? "", ctx);
  });

  const badSapEvidences = await prisma.projectItemEvidence.findMany({
    where: { sourceType: "sap", projectItemId: { in: badMaterialLinks.map((item) => item.id) } }
  });

  console.log(dryRun ? "SIMULACION (no se modifica nada)" : "REPARACION");
  console.log("=".repeat(46));
  console.log(`evidencias de altas ajenas      : ${badEvidences.length} de ${evidences.length}`);
  console.log(`altas atribuidas a otro producto: ${badRequests.length} de ${requests.length}`);
  console.log(`componentes con alta ajena      : ${badLinks.length} de ${items.length}`);
  console.log(`componentes con material ajeno  : ${badMaterialLinks.length}`);
  for (const item of badMaterialLinks) {
    console.log(`    ${item.project.code} / ${item.name} -> ${item.materialMaster?.materialCode} ${item.materialMaster?.description ?? ""}`);
  }

  console.log("\nQUE SE DESVINCULA:");
  for (const request of badRequests) {
    console.log(`  ${request.project.code.padEnd(46).slice(0, 46)} <- ${request.requestCode ?? "?"} ${request.requestedDescription}`);
  }

  if (dryRun) {
    console.log("\nCorrer sin --dry-run para aplicar.");
    return;
  }

  // El orden importa: primero se suelta el vinculo del componente, despues se
  // borran las evidencias y por ultimo las altas que quedaron sin duenio.
  for (const item of badLinks) {
    await prisma.projectItem.update({ where: { id: item.id }, data: { materialRequestId: null } });
  }

  for (const item of badMaterialLinks) {
    await prisma.projectItem.update({
      where: { id: item.id },
      data: { materialMasterId: null, expectedMaterialCode: null }
    });
  }

  await prisma.projectItemEvidence.deleteMany({ where: { id: { in: badSapEvidences.map((e) => e.id) } } });

  await prisma.projectItemEvidence.deleteMany({ where: { id: { in: badEvidences.map((e) => e.id) } } });
  await prisma.materialRequest.deleteMany({ where: { id: { in: badRequests.map((r) => r.id) } } });

  console.log(`\nlisto: ${badLinks.length} componentes desvinculados, ${badEvidences.length} evidencias borradas, ${badRequests.length} altas borradas.`);
  console.log("Las altas borradas vuelven a entrar -en el proyecto correcto- al reimportar la planilla.");

  // El estado y los avisos de cada componente dependen de lo que acabamos de
  // sacar, asi que hay que recalcular.
  const { projectItemsService } = await import("@/server/services/project-items-service");
  const all = await prisma.projectItem.findMany({ select: { id: true } });
  for (const item of all) {
    await projectItemsService.recalculateProjectItem(item.id);
  }
  console.log(`recalculados ${all.length} componentes.`);
}

main()
  .catch((error) => {
    console.error("FALLO:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
