import { MaterialType, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  materialClassToPackagingLevel,
  parseSapMaterialMaster,
  type SapMaterialLifecycle,
  type SapMaterialRow
} from "@/server/etl/sap-material-master";
import { projectItemEvidencesRepository } from "@/server/repositories/project-item-evidences-repository";
import { projectItemsService } from "@/server/services/project-items-service";

const UPSERT_CHUNK = 200;

/**
 * Importa un corte del maestro de materiales de SAP y lo vincula a los
 * componentes que ya sigue la aplicacion.
 *
 * El catalogo completo se guarda en `SapMaterial` (sirve para consultar
 * cualquier codigo), pero solo se materializa `MaterialsMaster` para los
 * materiales que efectivamente matchean con un project_item: crear 3.700
 * registros de maestro interno para materiales que nadie usa seria ruido.
 */

function packagingMaterialType(row: SapMaterialRow): MaterialType {
  // La descripcion es la señal primaria (99% de coincidencia con la clase de
  // SAP); la clase se usa como respaldo cuando la descripcion no dice nada.
  const description = (row.description ?? "").toUpperCase();

  if (/^PROSP/.test(description)) return MaterialType.LEAFLET;
  if (/^ETIQ/.test(description)) return MaterialType.LABEL;
  if (/^EST\.|^EST /.test(description)) return MaterialType.SECONDARY_PACKAGING;
  if (/^(FCO|FRASCO|POMO|ALUM|TAPA|BOMBA|FOLIA)/.test(description)) return MaterialType.PRIMARY_PACKAGING;

  const level = materialClassToPackagingLevel(row.materialClass);

  if (level === "PRIMARY") return MaterialType.PRIMARY_PACKAGING;
  if (level === "SECONDARY") return MaterialType.SECONDARY_PACKAGING;

  return MaterialType.OTHER;
}

/**
 * Discrepancia entre lo que dice la descripcion y la clase de material de SAP.
 * Es el 1% de los casos; se reporta en lugar de resolverse en silencio.
 */
function classMismatch(row: SapMaterialRow) {
  const description = (row.description ?? "").toUpperCase();
  const level = materialClassToPackagingLevel(row.materialClass);

  if (!level) {
    return false;
  }

  const looksSecondary = /^(EST\.|EST |PROSP|ETIQ)/.test(description);
  const looksPrimary = /^(FCO|FRASCO|POMO|ALUM|TAPA|BOMBA)/.test(description);

  return (looksSecondary && level === "PRIMARY") || (looksPrimary && level === "SECONDARY");
}

function lifecycleLabel(lifecycle: SapMaterialLifecycle) {
  switch (lifecycle) {
    case "CURRENT":
      return "vigente en SAP";
    case "DISCONTINUED":
      return "discontinuado en SAP (grupo 051)";
    case "ERRONEOUS_CODE":
      return "codigo marcado como erroneo en SAP";
  }
}

async function chunked<T>(items: T[], size: number, run: (chunk: T[]) => Promise<unknown>) {
  for (let index = 0; index < items.length; index += size) {
    await run(items.slice(index, index + size));
  }
}

export type SapMasterImportResult = {
  snapshotId: string;
  dataDate: string | null;
  receivedAt: string | null;
  sourceFileName: string;
  catalog: {
    total: number;
    current: number;
    discontinued: number;
    erroneousCode: number;
    classMismatches: number;
  };
  linkage: {
    itemsEvaluated: number;
    matched: number;
    matchedCurrent: number;
    matchedDiscontinued: number;
    matchedErroneous: number;
    unmatched: number;
  };
  matchedDetails: Array<{
    projectCode: string;
    itemKey: string;
    materialCode: string;
    lifecycle: SapMaterialLifecycle;
    sapDescription: string | null;
  }>;
  unmatchedDetails: Array<{ projectCode: string; itemKey: string; searchedCodes: string[] }>;
};

export const sapMasterImportService = {
  async importSnapshot(params: { workbookPath: string; sheetName?: string }): Promise<SapMasterImportResult> {
    const parsed = parseSapMaterialMaster(params.workbookPath, params.sheetName);

    if (!parsed.dataDate) {
      throw new Error(
        "No se pudo derivar la fecha de datos del corte: ninguna fila trae fecha de ultima modificacion."
      );
    }

    const mismatches = parsed.rows.filter(classMismatch).length;

    const snapshot = await prisma.sapMasterSnapshot.create({
      data: {
        dataDate: parsed.dataDate,
        receivedAt: parsed.receivedAt,
        sourceFileName: parsed.sourceFileName,
        materialCount: parsed.diagnostics.totalRows,
        currentCount: parsed.diagnostics.current,
        discontinuedCount: parsed.diagnostics.discontinued,
        erroredCount: parsed.diagnostics.erroneousCode
      }
    });

    // Catalogo completo: upsert por codigo para conservar los vinculos ya
    // establecidos con MaterialsMaster entre un corte y el siguiente.
    await chunked(parsed.rows, UPSERT_CHUNK, async (chunk) => {
      await prisma.$transaction(
        chunk.map((row) =>
          prisma.sapMaterial.upsert({
            where: { materialCode: row.materialCode },
            update: {
              description: row.description,
              activeFlag: row.lifecycle === "CURRENT",
              purchaseStatus: row.statusCode,
              materialGroup: row.materialGroup,
              materialClass: row.materialClass,
              deletionFlag: row.deletionFlag,
              discontinued: row.lifecycle === "DISCONTINUED",
              baseUom: row.baseUom,
              sourceCreatedAt: row.createdAt,
              sourceUpdatedAt: row.lastModifiedAt,
              snapshotId: snapshot.id
            },
            create: {
              materialCode: row.materialCode,
              description: row.description,
              activeFlag: row.lifecycle === "CURRENT",
              purchaseStatus: row.statusCode,
              materialGroup: row.materialGroup,
              materialClass: row.materialClass,
              deletionFlag: row.deletionFlag,
              discontinued: row.lifecycle === "DISCONTINUED",
              baseUom: row.baseUom,
              sourceCreatedAt: row.createdAt,
              sourceUpdatedAt: row.lastModifiedAt,
              snapshotId: snapshot.id
            }
          })
        )
      );
    });

    const byCode = new Map(parsed.rows.map((row) => [row.materialCode.toUpperCase(), row]));
    const linkage = await this.linkProjectItems(byCode, snapshot.id);

    return {
      snapshotId: snapshot.id,
      dataDate: parsed.dataDate.toISOString(),
      receivedAt: parsed.receivedAt?.toISOString() ?? null,
      sourceFileName: parsed.sourceFileName,
      catalog: {
        total: parsed.diagnostics.totalRows,
        current: parsed.diagnostics.current,
        discontinued: parsed.diagnostics.discontinued,
        erroneousCode: parsed.diagnostics.erroneousCode,
        classMismatches: mismatches
      },
      ...linkage
    };
  },

  /**
   * Busca cada project_item en el catalogo por los codigos que conoce y, cuando
   * lo encuentra, materializa el maestro interno y deja evidencia `sap`.
   */
  async linkProjectItems(byCode: Map<string, SapMaterialRow>, snapshotId: string) {
    const items = await prisma.projectItem.findMany({
      include: {
        project: { select: { code: true } },
        materialRequest: { select: { requestCode: true, linkedMaterialCode: true } }
      }
    });

    const matchedDetails: SapMasterImportResult["matchedDetails"] = [];
    const unmatchedDetails: SapMasterImportResult["unmatchedDetails"] = [];
    const touched = new Set<string>();
    let matchedCurrent = 0;
    let matchedDiscontinued = 0;
    let matchedErroneous = 0;

    for (const item of items) {
      // Codigos por los que el item puede conocerse, de mas a menos confiable.
      const candidates = [
        item.expectedMaterialCode,
        item.materialRequest?.linkedMaterialCode,
        item.materialRequest?.requestCode,
        item.provisionalCode
      ].filter((code): code is string => Boolean(code && code.trim()));

      const hit = candidates.map((code) => byCode.get(code.trim().toUpperCase())).find(Boolean);

      if (!hit) {
        unmatchedDetails.push({
          projectCode: item.project.code,
          itemKey: item.itemKey,
          searchedCodes: candidates
        });
        continue;
      }

      const master = await prisma.materialsMaster.upsert({
        where: { materialCode: hit.materialCode },
        update: {
          description: hit.description ?? hit.materialCode,
          rootCode: hit.rootCode,
          versionLabel: hit.versionLabel,
          materialType: packagingMaterialType(hit),
          activeFlag: hit.lifecycle === "CURRENT"
        },
        create: {
          materialCode: hit.materialCode,
          description: hit.description ?? hit.materialCode,
          rootCode: hit.rootCode,
          versionLabel: hit.versionLabel,
          materialType: packagingMaterialType(hit),
          activeFlag: hit.lifecycle === "CURRENT"
        }
      });

      await prisma.sapMaterial.update({
        where: { materialCode: hit.materialCode },
        data: { materialMasterId: master.id }
      });

      await prisma.projectItem.update({
        where: { id: item.id },
        data: { materialMasterId: master.id }
      });

      await projectItemEvidencesRepository.upsert({
        projectItemId: item.id,
        sourceType: "sap",
        sourceRecordKey: `sap:${hit.materialCode}`,
        matchRule: "sap_material_code",
        matchConfidence: "HIGH",
        matchStatus: hit.lifecycle === "CURRENT" ? "EXACT" : "MANUAL_REVIEW",
        isPrimary: false,
        rawLabel: hit.description,
        rawData: {
          sourceType: "sap",
          materialCode: hit.materialCode,
          lifecycle: hit.lifecycle,
          lifecycleLabel: lifecycleLabel(hit.lifecycle),
          materialClass: hit.materialClass,
          materialGroup: hit.materialGroup,
          deletionFlag: hit.deletionFlag,
          rootCode: hit.rootCode,
          versionLabel: hit.versionLabel,
          versionSource: hit.versionSource,
          baseUom: hit.baseUom,
          classMismatch: classMismatch(hit),
          snapshotId
        } satisfies Prisma.InputJsonObject
      });

      if (hit.lifecycle === "CURRENT") matchedCurrent += 1;
      else if (hit.lifecycle === "DISCONTINUED") matchedDiscontinued += 1;
      else matchedErroneous += 1;

      matchedDetails.push({
        projectCode: item.project.code,
        itemKey: item.itemKey,
        materialCode: hit.materialCode,
        lifecycle: hit.lifecycle,
        sapDescription: hit.description
      });
      touched.add(item.id);
    }

    for (const itemId of touched) {
      await projectItemsService.recalculateProjectItem(itemId);
    }

    return {
      linkage: {
        itemsEvaluated: items.length,
        matched: matchedDetails.length,
        matchedCurrent,
        matchedDiscontinued,
        matchedErroneous,
        unmatched: unmatchedDetails.length
      },
      matchedDetails,
      unmatchedDetails: unmatchedDetails.slice(0, 20)
    };
  },

  /** Ultimo corte importado, para que la UI pueda decir de cuando son los datos. */
  async getLatestSnapshot() {
    return prisma.sapMasterSnapshot.findFirst({ orderBy: [{ dataDate: "desc" }] });
  }
};
