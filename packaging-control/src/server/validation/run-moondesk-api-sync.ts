import { prisma } from "@/lib/prisma";
import { moondeskApiService } from "@/server/services/moondesk-api-service";

/**
 * Sincroniza los documentos de MoonDesk via API y compara el resultado contra
 * lo que ya sabiamos por los reportes Excel.
 *
 * La comparacion es el punto: la fuente Excel ya esta validada contra casos
 * reales, asi que sirve de patron para confirmar que la API dice lo mismo antes
 * de que el tablero dependa de ella.
 *
 *   npm run sync:moondesk-api                 sincroniza todo y compara
 *   npm run sync:moondesk-api -- --check      solo prueba la conexion
 *   npm run sync:moondesk-api -- --compare    solo compara lo ya sincronizado
 *   npm run sync:moondesk-api -- --since=2026-01-01
 */

function parseArgs() {
  const args = process.argv.slice(2);
  const sinceArg = args.find((arg) => arg.startsWith("--since="))?.split("=")[1];

  return {
    checkOnly: args.includes("--check"),
    compareOnly: args.includes("--compare"),
    since: sinceArg ? new Date(sinceArg) : undefined
  };
}

async function main() {
  const { checkOnly, compareOnly, since } = parseArgs();

  if (compareOnly) {
    await compareWithExcelSource();
    return;
  }

  console.log("Conexion con MoonDesk");
  console.log("=====================");
  const connection = await moondeskApiService.checkConnection();
  console.log(`servidor        : ${connection.baseUrl}`);
  console.log(`tipos de documento: ${connection.documentTypes.length}`);
  console.log(`clasificadores  : ${connection.classes.map((c) => `${c.name} (${c.valueCount})`).join(", ")}`);

  if (checkOnly) {
    return;
  }

  console.log(`\nSincronizando${since ? ` desde ${since.toISOString().slice(0, 10)}` : " todo"}...`);
  let lastReported = 0;
  const result = await moondeskApiService.sync({
    since,
    onProgress: (page, pageCount, total) => {
      if (page === 1) console.log(`  ${total} documentos en ${pageCount} paginas`);
      const percent = Math.floor((page / pageCount) * 100);
      if (percent >= lastReported + 20 || page === pageCount) {
        console.log(`  ${percent}% (pagina ${page}/${pageCount})`);
        lastReported = percent;
      }
    }
  });

  console.log("\nResultado");
  console.log("=========");
  console.log(`documentos sincronizados        : ${result.documentCount}`);
  console.log(`  version vigente aprobada      : ${result.approvedCurrent}`);
  console.log(`  aprobada pero con borradores  : ${result.approvedOutdated}`);
  console.log(`  sin ninguna version aprobada  : ${result.neverApproved}`);
  console.log(`documentos sin codigo de insumo : ${result.documentsWithoutMaterialCode}`);
  console.log(`codigos del sistema viejo       : ${result.legacyCodeCount} (validos)`);

  if (result.malformedCodes.length) {
    console.log(`\ncodigos MOON mal tipeados (${result.malformedCodes.length}): rompen el cruce con DOCUMENTOS APROBADOS`);
    for (const code of result.malformedCodes) {
      const docs = await prisma.moondeskApiDocument.findMany({
        where: {
          OR: [{ drawingCode: code }, { specificationCode: code }, { technicalSheetCode: code }]
        },
        select: { documentNumber: true, materialCode: true, productName: true }
      });
      console.log(
        `  ${code.padEnd(14)} -> ${docs
          .map((d) => `#${d.documentNumber} ${d.materialCode ?? "?"} ${d.productName ?? ""}`.trim())
          .join(" | ")}`
      );
    }
  }

  await compareWithExcelSource();
}

/**
 * Contrasta la API contra los componentes que ya tenemos, usando el reporte
 * Excel como patron. Lo que importa no es que los numeros coincidan (la API
 * cubre mucho mas), sino que **no se contradigan** donde ambas fuentes opinan.
 */
async function compareWithExcelSource() {
  const items = await prisma.projectItem.findMany({
    include: { materialMaster: true, moondeskTasks: { include: { documents: true } }, project: true }
  });

  const codes = items
    .map((item) => item.materialMaster?.materialCode ?? item.expectedMaterialCode)
    .filter((code): code is string => Boolean(code));
  const byCode = await moondeskApiService.getByMaterialCodes(codes);

  let bothKnow = 0;
  let onlyApi = 0;
  let onlyExcel = 0;
  let neither = 0;
  const contradictions: string[] = [];
  const newlyOutdated: string[] = [];

  for (const item of items) {
    const code = item.materialMaster?.materialCode ?? item.expectedMaterialCode;
    const apiDocs = code ? (byCode.get(code.trim().toUpperCase()) ?? []) : [];
    const excelApproved = item.moondeskTasks.some(
      (task) => task.approvedVersionAvailable || task.documents.some((document) => document.approved)
    );
    const apiApproved = apiDocs.length > 0 && apiDocs.every((doc) => doc.approvalState !== "never_approved");

    if (apiDocs.length && item.moondeskTasks.length) bothKnow += 1;
    else if (apiDocs.length) onlyApi += 1;
    else if (item.moondeskTasks.length) onlyExcel += 1;
    else neither += 1;

    // Solo es contradiccion cuando las dos fuentes tienen algo que decir.
    if (apiDocs.length && item.moondeskTasks.length && excelApproved !== apiApproved) {
      contradictions.push(
        `${item.project.code} / ${item.name} (${code}): Excel=${excelApproved ? "aprobado" : "sin aprobar"} API=${apiApproved ? "aprobado" : "sin aprobar"}`
      );
    }

    const outdated = apiDocs.filter((doc) => doc.approvalState === "approved_outdated");

    if (outdated.length) {
      newlyOutdated.push(
        `${item.project.code} / ${item.name} (${code}): ${outdated
          .map((doc) => `#${doc.documentNumber} aprobada v${doc.approvedVersionNumber} pero va por v${doc.latestVersionNumber}`)
          .join(", ")}`
      );
    }
  }

  console.log("\nComparacion contra la fuente Excel");
  console.log("==================================");
  console.log(`componentes evaluados            : ${items.length}`);
  console.log(`  las dos fuentes lo conocen     : ${bothKnow}`);
  console.log(`  solo la API lo conoce          : ${onlyApi}`);
  console.log(`  solo el Excel lo conoce        : ${onlyExcel}`);
  console.log(`  ninguna de las dos             : ${neither}`);
  console.log(`contradicciones                  : ${contradictions.length}`);

  for (const line of contradictions.slice(0, 15)) {
    console.log(`  ! ${line}`);
  }

  console.log(`\ncomponentes con arte aprobado pero borradores mas nuevos: ${newlyOutdated.length}`);
  for (const line of newlyOutdated.slice(0, 15)) {
    console.log(`  - ${line}`);
  }
}

main()
  .catch((error) => {
    console.error("\nFALLO:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
