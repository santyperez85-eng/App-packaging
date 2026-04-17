import {
  AlertStatus,
  BusinessUnit,
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
  const normalized = normalizeText(value).replace(/-/g, "_").toUpperCase();

  if (
    normalized === MaterialRequestStatus.REQUESTED ||
    normalized === MaterialRequestStatus.IN_PROGRESS ||
    normalized === MaterialRequestStatus.COMPLETED ||
    normalized === MaterialRequestStatus.CANCELLED
  ) {
    return normalized as MaterialRequestStatus;
  }

  return MaterialRequestStatus.REQUESTED;
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

        await materialRequestsRepository.upsert({
          sourceExternalId: `${project.code}-${row.requestCode ?? row.rowNumber}`,
          projectId: project.id,
          requestCode: row.requestCode,
          requestDate: row.requestDate,
          requestedByName: row.requestedBy,
          requestedDescription: row.requestedDescription,
          materialType: inferMaterialType(row.materialType),
          requestStatus: parseMaterialRequestStatus(row.requestStatus),
          linkedMaterialCode: row.linkedMaterialCode,
          linkedMaterialId: linkedMaterial?.id
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
        const resolution = await resolveProjectItemMatch({
          sourceType: "material_request",
          sourceRecordKey: request.sourceExternalId ?? request.id,
          project: {
            id: project.id,
            code: project.code,
            sapFinishedCode: project.sapFinishedCode
          },
          materialCode: request.linkedMaterialCode,
          provisionalCode: request.requestCode,
          rawLabel: request.requestedDescription,
          description: request.requestedDescription,
          componentSlot: inferComponentSlot(request.requestedDescription),
          originMode: ProjectItemOriginMode.REQUEST_DETECTED
        });

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
          itemType: inferItemType(request.requestedDescription),
          criticality: ItemCriticality.HIGH,
          materialRequestId: request.id,
          materialMasterId: linkedMaterial?.id ?? request.linkedMaterialId,
          expectedMaterialCode: request.linkedMaterialCode,
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
          rawLabel: request.requestedDescription
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
