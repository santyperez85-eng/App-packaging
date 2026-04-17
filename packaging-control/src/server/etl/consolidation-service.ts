import {
  AlertStatus,
  BusinessUnit,
  ComponentSlot,
  ItemCriticality,
  MatchConfidence,
  MaterialRequestStatus,
  MatchingStatus,
  Prisma,
  ProjectItemIdentificationStatus,
  ProjectItemOriginMode,
  ProjectStatus
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  inferBusinessUnit,
  inferComponentSlot,
  inferItemType,
  inferMaterialType,
  normalizeText,
  parseScopeDefined,
  stringOrNull,
  slugify
} from "@/lib/utils";
import { bomItemsRepository } from "@/server/repositories/bom-items-repository";
import { importsRepository } from "@/server/repositories/imports-repository";
import { extractPmExpectedComponents } from "@/server/etl/pm-expected-components";
import { materialRequestsRepository } from "@/server/repositories/material-requests-repository";
import { materialsMasterRepository } from "@/server/repositories/materials-master-repository";
import { resolveProjectForSource, resolveProjectItemMatch } from "@/server/matching/project-item-matcher";
import { projectItemEvidencesRepository } from "@/server/repositories/project-item-evidences-repository";
import { projectItemsRepository } from "@/server/repositories/project-items-repository";
import { projectsRepository } from "@/server/repositories/projects-repository";
import { getRowValue } from "@/server/etl/excel";
import { projectItemsService } from "@/server/services/project-items-service";

function buildProjectCode(row: { projectCode?: string | null; projectName?: string | null }) {
  return row.projectCode ?? `PRJ-${slugify(row.projectName ?? "sin-codigo").toUpperCase()}`;
}

function extractSapFinishedCode(rawData: unknown) {
  if (!rawData || typeof rawData !== "object") {
    return null;
  }

  return stringOrNull(
    getRowValue(rawData as Record<string, unknown>, [
      "sap_finished_code",
      "finished_code",
      "codigo sap pt",
      "codigo terminado"
    ])
  );
}

async function resolveProjectFromImportSource(params: {
  sourceType: string;
  sourceRecordKey: string;
  projectCode?: string | null;
  rawData?: unknown;
}) {
  const resolution = await resolveProjectForSource({
    sourceType: params.sourceType,
    sourceRecordKey: params.sourceRecordKey,
    projectCode: params.projectCode ?? null,
    sapFinishedCode: extractSapFinishedCode(params.rawData)
  });

  if (!resolution.project) {
    throw new Error(`Project could not be resolved (${resolution.matchRule})`);
  }

  if (resolution.matchStatus === MatchingStatus.MANUAL_REVIEW) {
    throw new Error(`Project match requires manual review (${resolution.matchRule})`);
  }

  return resolution.project;
}

function parseMaterialRequestStatus(value: string | null | undefined) {
  const normalizedText = normalizeText(value).replace(/[_-]+/g, " ").trim();
  const normalized = normalizedText.replace(/\s+/g, "_").toUpperCase();

  if (
    normalized === MaterialRequestStatus.REQUESTED ||
    normalized === MaterialRequestStatus.IN_PROGRESS ||
    normalized === MaterialRequestStatus.COMPLETED ||
    normalized === MaterialRequestStatus.CANCELLED
  ) {
    return normalized as MaterialRequestStatus;
  }

  if (["solicitado", "solicitada", "pedido", "pedida", "pendiente"].includes(normalizedText)) {
    return MaterialRequestStatus.REQUESTED;
  }

  if (
    ["en curso", "en proceso", "proceso", "procesando", "iniciado", "iniciada", "abierto", "abierta"].includes(
      normalizedText
    )
  ) {
    return MaterialRequestStatus.IN_PROGRESS;
  }

  if (["completo", "completa", "completado", "completada", "finalizado", "finalizada", "cerrado", "cerrada"].includes(normalizedText)) {
    return MaterialRequestStatus.COMPLETED;
  }

  if (isIgnoredMaterialRequestStatus(value)) {
    return MaterialRequestStatus.CANCELLED;
  }

  return MaterialRequestStatus.REQUESTED;
}

const IGNORED_MATERIAL_REQUEST_STATUS_VALUES = new Set([
  "cancelado",
  "cancelada",
  "cancelled",
  "canceled",
  "anulado",
  "anulada",
  "baja",
  "rechazado",
  "rechazada",
  "no aplica",
  "no aplicable",
  "does not apply",
  "not applicable",
  "n a",
  "na"
]);

function isIgnoredMaterialRequestStatus(value: string | null | undefined) {
  const normalized = normalizeText(value).replace(/[_/.-]+/g, " ").replace(/\s+/g, " ").trim();

  return IGNORED_MATERIAL_REQUEST_STATUS_VALUES.has(normalized);
}

function getRawObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function getNestedObject(value: unknown, key: string) {
  const object = getRawObject(value);
  const nested = object[key];

  return getRawObject(nested);
}

function parseComponentSlotValue(value: unknown) {
  const directValue = stringOrNull(value);

  if (!directValue) {
    return null;
  }

  if (Object.values(ComponentSlot).includes(directValue as ComponentSlot)) {
    return directValue as ComponentSlot;
  }

  const inferred = inferComponentSlot(directValue);

  return inferred === ComponentSlot.OTRO ? null : inferred;
}

function componentSlotFromNotes(notes: unknown) {
  const noteValue = stringOrNull(notes);

  if (!noteValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(noteValue) as unknown;
    const parsedSlot = parseComponentSlotValue(getRawObject(parsed).sourceComponentSlot);

    if (parsedSlot) {
      return parsedSlot;
    }
  } catch {
    const match = noteValue.match(/sourceComponentSlot=([A-Z_]+)/);

    if (match?.[1]) {
      return parseComponentSlotValue(match[1]);
    }
  }

  return null;
}

function explicitComponentSlotFromMaterialRequest(rawData: unknown, materialType?: string | null) {
  const rawObject = getRawObject(rawData);
  const normalization = getNestedObject(rawData, "sourceNormalization");
  const normalizedSlot = parseComponentSlotValue(normalization.explicitComponentSlot);

  if (normalizedSlot) {
    return normalizedSlot;
  }

  const rawSlot = parseComponentSlotValue(
    getRowValue(rawObject, [
      "component_slot",
      "componentSlot",
      "slot",
      "component",
      "componente",
      "tipo componente",
      "tipo_componente",
      "componente packaging",
      "componente_packaging",
      "pieza"
    ])
  );

  if (rawSlot) {
    return rawSlot;
  }

  const notesSlot = componentSlotFromNotes(rawObject.notes);

  if (notesSlot) {
    return notesSlot;
  }

  return parseComponentSlotValue(materialType);
}

function buildMaterialRequestEvidenceRawData(params: {
  requestId: string;
  sourceExternalId?: string | null;
  requestCode?: string | null;
  requestStatus: MaterialRequestStatus;
  linkedMaterialCode?: string | null;
  componentSlot: ComponentSlot;
}) {
  return {
    sourceType: "material_request",
    materialRequestId: params.requestId,
    sourceExternalId: params.sourceExternalId ?? null,
    requestCode: params.requestCode ?? null,
    requestStatus: params.requestStatus,
    linkedMaterialCode: params.linkedMaterialCode ?? null,
    explicitComponentSlot: params.componentSlot
  } satisfies Prisma.InputJsonObject;
}

export const consolidationService = {
  async consolidatePendingImports() {
    const summary = {
      productsUpserted: 0,
      projectsUpserted: 0,
      materialsUpserted: 0,
      requestsUpserted: 0,
      bomItemsUpserted: 0,
      projectItemsUpserted: 0,
      evidencesUpserted: 0,
      alertsRefreshed: 0
    };

    const pendingMaterialRows = await importsRepository.getPendingMaterialMasterRows();

    for (const row of pendingMaterialRows) {
      try {
        if (!row.materialCode || !row.description) {
          throw new Error("materialCode and description are required");
        }

        await materialsMasterRepository.upsert({
          materialCode: row.materialCode,
          description: row.description,
          materialType: inferMaterialType(row.materialType),
          format: row.format,
          measures: row.measures,
          drawingCode: row.drawingCode,
          specificationCode: row.specificationCode,
          technicalSheetCode: row.technicalSheetCode,
          observations: row.observations,
          activeFlag: true
        });

        await importsRepository.markMaterialMasterRowProcessed(row.id);
        summary.materialsUpserted += 1;
      } catch (error) {
        await importsRepository.markMaterialMasterRowError(row.id, error instanceof Error ? error.message : "Unknown error");
      }
    }

    const pendingPmRows = await importsRepository.getPendingPmRows();

    for (const row of pendingPmRows) {
      try {
        const projectCode = buildProjectCode(row);
        const rawPmData = row.rawData as Record<string, unknown>;
        const businessUnit =
          row.businessUnit ??
          inferBusinessUnit(rawPmData.business_unit) ??
          BusinessUnit.PHARMA;
        const activeIngredient =
          row.activeIngredient ??
          stringOrNull(
            getRowValue(rawPmData, [
              "active_ingredient",
              "activeIngredient",
              "droga_activa",
              "drogaActiva",
              "droga activa",
              "principio activo",
              "ingrediente activo"
            ])
          );
        const productReference =
          row.productReference ?? `PROD-${slugify(`${row.productName ?? "producto"}-${row.presentation ?? ""}`).toUpperCase()}`;
        const product = await prisma.product.upsert({
          where: { referenceCode: productReference },
          update: {
            name: row.productName ?? "Producto sin nombre",
            businessUnit,
            presentation: row.presentation
          },
          create: {
            referenceCode: productReference,
            name: row.productName ?? "Producto sin nombre",
            businessUnit,
            presentation: row.presentation
          }
        });

        summary.productsUpserted += 1;

        await projectsRepository.upsert({
          code: projectCode,
          name: row.projectName ?? projectCode,
          businessUnit,
          caseType: String(getRowValue(rawPmData, ["case_type", "tipo caso", "initiative_type"]) ?? "").trim() || null,
          changeDriver:
            String(getRowValue(rawPmData, ["change_driver", "motivo cambio", "driver"]) ?? "").trim() || null,
          presentation: row.presentation,
          activeIngredient,
          sapFinishedCode:
            String(
              getRowValue(rawPmData, ["sap_finished_code", "finished_code", "codigo sap pt", "codigo terminado"]) ?? ""
            ).trim() || null,
          scopeDefined: getRowValue(rawPmData, ["scope_defined", "alcance definido", "scope_status"])
            ? parseScopeDefined(getRowValue(rawPmData, ["scope_defined", "alcance definido", "scope_status"]))
            : row.presentation
              ? "PARTIAL"
              : "UNKNOWN",
          productId: product.id,
          sourcePmKey: row.projectCode ?? projectCode,
          macroStatus: row.macroStatus,
          startDate: row.startDate,
          targetLaunchDate: row.targetLaunchDate,
          status: ProjectStatus.ACTIVE
        });

        await importsRepository.markPmRowProcessed(row.id);
        summary.projectsUpserted += 1;
      } catch (error) {
        await importsRepository.markPmRowError(row.id, error instanceof Error ? error.message : "Unknown error");
      }
    }

    const pendingRequestRows = await importsRepository.getPendingMaterialRequestRows();

    for (const row of pendingRequestRows) {
      try {
        if (isIgnoredMaterialRequestStatus(row.requestStatus)) {
          await importsRepository.markMaterialRequestRowIgnored(
            row.id,
            `requestStatus=${row.requestStatus ?? "sin estado"} does not count as operational evidence`
          );
          continue;
        }

        const sourceRecordKey = row.requestCode ?? String(row.rowNumber);
        const project = await resolveProjectFromImportSource({
          sourceType: "material_request",
          sourceRecordKey,
          projectCode: row.projectCode,
          rawData: row.rawData
        });

        if (!project || !row.requestedDescription) {
          throw new Error("Project or requestedDescription not found");
        }

        const linkedMaterial = row.linkedMaterialCode
          ? await materialsMasterRepository.findByCode(row.linkedMaterialCode)
          : null;
        const explicitComponentSlot = explicitComponentSlotFromMaterialRequest(row.rawData, row.materialType);

        await materialRequestsRepository.upsert({
          sourceExternalId: `${project.code}-${row.requestCode ?? row.rowNumber}`,
          projectId: project.id,
          requestCode: row.requestCode,
          requestDate: row.requestDate,
          requestedByName: row.requestedBy,
          requestedDescription: row.requestedDescription,
          materialType: inferMaterialType(
            row.materialType ?? explicitComponentSlot
          ),
          requestStatus: parseMaterialRequestStatus(row.requestStatus),
          linkedMaterialCode: row.linkedMaterialCode,
          linkedMaterialId: linkedMaterial?.id,
          notes: explicitComponentSlot ? JSON.stringify({ sourceComponentSlot: explicitComponentSlot }) : null
        });

        await importsRepository.markMaterialRequestRowProcessed(row.id);
        summary.requestsUpserted += 1;
      } catch (error) {
        await importsRepository.markMaterialRequestRowError(
          row.id,
          error instanceof Error ? error.message : "Unknown error"
        );
      }
    }

    const pendingBomRows = await importsRepository.getPendingBomRows();

    for (const row of pendingBomRows) {
      try {
        const sourceRecordKey = row.componentKey ?? String(row.rowNumber);
        const project = await resolveProjectFromImportSource({
          sourceType: "bom",
          sourceRecordKey,
          projectCode: row.projectCode,
          rawData: row.rawData
        });

        if (!project || !row.componentName) {
          throw new Error("Project or componentName not found");
        }

        await bomItemsRepository.upsert({
          projectId: project.id,
          componentKey: row.componentKey ?? slugify(row.componentName).toUpperCase(),
          componentName: row.componentName,
          componentType: inferItemType(row.componentType ?? row.componentName),
          quantity: row.quantity,
          unit: row.unit,
          isPackaging: row.isPackaging ?? true,
          isCritical: true,
          expectedMaterialCode: row.expectedMaterialCode
        });

        await importsRepository.markBomRowProcessed(row.id);
        summary.bomItemsUpserted += 1;
      } catch (error) {
        await importsRepository.markBomRowError(row.id, error instanceof Error ? error.message : "Unknown error");
      }
    }

    const projects = await prisma.project.findMany({
      include: {
        bomItems: {
          where: { isPackaging: true }
        },
        materialRequests: true,
        projectItems: true
      }
    });

    for (const project of projects) {
      const latestPmRow = await importsRepository.findLatestPmRowForProject({
        sourcePmKey: project.sourcePmKey,
        projectCode: project.code
      });
      const pmExpectedComponents = latestPmRow
        ? extractPmExpectedComponents(latestPmRow.rawData as Record<string, unknown>, {
            projectCode: project.code,
            projectName: project.name
          })
        : [];

      for (const expectedComponent of pmExpectedComponents) {
        const resolution = await resolveProjectItemMatch({
          sourceType: "pm_expected",
          sourceRecordKey: expectedComponent.sourceRecordKey,
          project: {
            id: project.id,
            code: project.code,
            sapFinishedCode: project.sapFinishedCode
          },
          rawLabel: expectedComponent.label,
          description: expectedComponent.label,
          componentSlot: expectedComponent.componentSlot,
          originMode: ProjectItemOriginMode.PM_EXPECTED
        });

        const item = await projectItemsRepository.upsert({
          projectId: project.id,
          itemKey: resolution.itemKey,
          name: resolution.itemName,
          description: resolution.matchedProjectItemId ? undefined : expectedComponent.label,
          componentSlot: expectedComponent.componentSlot,
          applicabilityStatus: expectedComponent.applicabilityStatus,
          originMode: resolution.originMode,
          provisional: resolution.matchedProjectItemId ? resolution.provisional : true,
          expectedStatus: resolution.expectedStatus,
          identificationStatus: resolution.identificationStatus,
          matchingStatus: resolution.matchingStatus,
          provisionalCode: resolution.provisionalCode ?? null,
          itemType: inferItemType(expectedComponent.label),
          criticality: ItemCriticality.HIGH,
          requiresApprovedDocument: true,
          requiresMaterialCode: true,
          requiresTechnicalDocs: true
        });

        await projectItemEvidencesRepository.upsert({
          projectItemId: item.id,
          sourceType: "pm_expected",
          sourceRecordKey: expectedComponent.sourceRecordKey,
          matchRule: resolution.matchRule,
          matchConfidence: resolution.matchConfidence,
          matchStatus: resolution.evidenceMatchStatus,
          isPrimary: true,
          rawLabel: expectedComponent.label,
          rawData: expectedComponent.traceability
            ? ({
                sourceType: "pm_expected",
                sourceRecordKey: expectedComponent.sourceRecordKey,
                definitionRule: expectedComponent.definitionRule,
                componentSlot: expectedComponent.componentSlot,
                label: expectedComponent.label,
                traceability: expectedComponent.traceability
              } satisfies Prisma.InputJsonObject)
            : undefined
        });
        summary.evidencesUpserted += 1;

        const evaluation = await projectItemsService.recalculateProjectItem(item.id);
        summary.projectItemsUpserted += 1;
        summary.alertsRefreshed += evaluation.activeAlerts.length;
      }

      for (const bomItem of project.bomItems) {
        const material = bomItem.expectedMaterialCode
          ? await materialsMasterRepository.findByCode(bomItem.expectedMaterialCode)
          : null;
        const request = await materialRequestsRepository.findLinkableRequest({
          projectId: project.id,
          linkedMaterialCode: bomItem.expectedMaterialCode,
          requestedDescription: bomItem.componentName
        });
        const resolution = await resolveProjectItemMatch({
          sourceType: "bom",
          sourceRecordKey: bomItem.componentKey,
          project: {
            id: project.id,
            code: project.code,
            sapFinishedCode: project.sapFinishedCode
          },
          materialCode: bomItem.expectedMaterialCode,
          provisionalCode: request?.requestCode ?? null,
          rawLabel: bomItem.componentName,
          description: bomItem.componentName,
          componentSlot: inferComponentSlot(bomItem.componentName),
          originMode: ProjectItemOriginMode.BOM_DETECTED
        });

        const item = await projectItemsRepository.upsert({
          projectId: project.id,
          itemKey: resolution.itemKey,
          name: resolution.itemName,
          componentSlot: resolution.componentSlot,
          applicabilityStatus: resolution.applicabilityStatus,
          originMode: resolution.originMode,
          provisional: !material,
          expectedStatus: resolution.expectedStatus,
          identificationStatus: material ? ProjectItemIdentificationStatus.IDENTIFIED : resolution.identificationStatus,
          matchingStatus: resolution.matchingStatus,
          provisionalCode:
            resolution.provisionalCode ?? (!material ? request?.requestCode ?? bomItem.expectedMaterialCode ?? null : null),
          itemType: bomItem.componentType,
          criticality: bomItem.isCritical ? ItemCriticality.CRITICAL : ItemCriticality.MEDIUM,
          bomItemId: bomItem.id,
          materialRequestId: request?.id ?? null,
          materialMasterId: material?.id ?? null,
          expectedMaterialCode: bomItem.expectedMaterialCode,
          requiresApprovedDocument: true,
          requiresMaterialCode: true,
          requiresTechnicalDocs: true
        });

        await projectItemEvidencesRepository.upsert({
          projectItemId: item.id,
          sourceType: "bom",
          sourceRecordKey: bomItem.componentKey,
          matchRule: resolution.matchRule,
          matchConfidence: resolution.matchConfidence,
          matchStatus: resolution.evidenceMatchStatus,
          isPrimary: true,
          rawLabel: bomItem.componentName
        });
        summary.evidencesUpserted += 1;

        if (material) {
          await projectItemEvidencesRepository.upsert({
            projectItemId: item.id,
            sourceType: "materials_master",
            sourceRecordKey: material.materialCode,
            matchRule: "material_code_exact",
            matchConfidence: MatchConfidence.HIGH,
            matchStatus: MatchingStatus.EXACT,
            isPrimary: false,
            rawLabel: material.description
          });
          summary.evidencesUpserted += 1;
        }

        const evaluation = await projectItemsService.recalculateProjectItem(item.id);
        summary.projectItemsUpserted += 1;
        summary.alertsRefreshed += evaluation.activeAlerts.length;
      }

      for (const request of project.materialRequests) {
        const linkedMaterial =
          request.linkedMaterialId
            ? await prisma.materialsMaster.findUnique({
                where: { id: request.linkedMaterialId }
              })
            : request.linkedMaterialCode
              ? await materialsMasterRepository.findByCode(request.linkedMaterialCode)
              : null;
        const explicitComponentSlot = explicitComponentSlotFromMaterialRequest(
          request,
          request.materialType
        );
        const componentSlot = explicitComponentSlot ?? inferComponentSlot(request.requestedDescription);
        const trustedMaterialCode = linkedMaterial?.materialCode ?? null;
        const resolution = await resolveProjectItemMatch({
          sourceType: "material_request",
          sourceRecordKey: request.sourceExternalId ?? request.id,
          project: {
            id: project.id,
            code: project.code,
            sapFinishedCode: project.sapFinishedCode
          },
          materialCode: trustedMaterialCode,
          provisionalCode: request.requestCode ?? request.linkedMaterialCode,
          rawLabel: request.requestedDescription,
          description: request.requestedDescription,
          componentSlot,
          originMode: ProjectItemOriginMode.REQUEST_DETECTED
        });

        if (!resolution.matchedProjectItemId && resolution.matchingStatus === MatchingStatus.MANUAL_REVIEW) {
          continue;
        }

        const item = await projectItemsRepository.upsert({
          projectId: project.id,
          itemKey: resolution.itemKey,
          name: resolution.itemName,
          componentSlot: resolution.componentSlot,
          applicabilityStatus: resolution.applicabilityStatus,
          originMode: resolution.originMode,
          provisional: !linkedMaterial,
          expectedStatus: resolution.expectedStatus,
          identificationStatus: linkedMaterial ? ProjectItemIdentificationStatus.IDENTIFIED : resolution.identificationStatus,
          matchingStatus: resolution.matchingStatus,
          provisionalCode: resolution.provisionalCode ?? request.requestCode ?? request.linkedMaterialCode ?? null,
          itemType: inferItemType(`${componentSlot} ${request.requestedDescription}`),
          criticality: ItemCriticality.HIGH,
          materialRequestId: request.id,
          materialMasterId: linkedMaterial?.id ?? request.linkedMaterialId,
          expectedMaterialCode: trustedMaterialCode,
          requiresApprovedDocument: true,
          requiresMaterialCode: true,
          requiresTechnicalDocs: true
        });

        await projectItemEvidencesRepository.upsert({
          projectItemId: item.id,
          sourceType: "material_request",
          sourceRecordKey: request.sourceExternalId ?? request.id,
          matchRule: resolution.matchRule,
          matchConfidence: resolution.matchConfidence,
          matchStatus: resolution.evidenceMatchStatus,
          isPrimary: true,
          rawLabel: request.requestedDescription,
          rawData: buildMaterialRequestEvidenceRawData({
            requestId: request.id,
            sourceExternalId: request.sourceExternalId,
            requestCode: request.requestCode,
            requestStatus: request.requestStatus,
            linkedMaterialCode: request.linkedMaterialCode,
            componentSlot
          })
        });
        summary.evidencesUpserted += 1;

        if (linkedMaterial) {
          await projectItemEvidencesRepository.upsert({
            projectItemId: item.id,
            sourceType: "materials_master",
            sourceRecordKey: linkedMaterial.materialCode,
            matchRule: "material_code_exact",
            matchConfidence: MatchConfidence.HIGH,
            matchStatus: MatchingStatus.EXACT,
            isPrimary: false,
            rawLabel: linkedMaterial.description
          });
          summary.evidencesUpserted += 1;
        }

        const evaluation = await projectItemsService.recalculateProjectItem(item.id);
        summary.projectItemsUpserted += 1;
        summary.alertsRefreshed += evaluation.activeAlerts.length;
      }
    }

    const openAlerts = await prisma.alert.count({
      where: { status: AlertStatus.OPEN }
    });

    return {
      ...summary,
      openAlerts
    };
  }
};
