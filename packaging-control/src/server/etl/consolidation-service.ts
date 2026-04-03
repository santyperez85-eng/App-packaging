import {
  AlertStatus,
  BusinessUnit,
  ItemCriticality,
  MaterialRequestStatus,
  ProjectStatus
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { inferBusinessUnit, inferItemType, inferMaterialType, normalizeText, slugify } from "@/lib/utils";
import { bomItemsRepository } from "@/server/repositories/bom-items-repository";
import { importsRepository } from "@/server/repositories/imports-repository";
import { materialRequestsRepository } from "@/server/repositories/material-requests-repository";
import { materialsMasterRepository } from "@/server/repositories/materials-master-repository";
import { projectItemsRepository } from "@/server/repositories/project-items-repository";
import { projectsRepository } from "@/server/repositories/projects-repository";
import { projectItemsService } from "@/server/services/project-items-service";

function buildProjectCode(row: { projectCode?: string | null; projectName?: string | null }) {
  return row.projectCode ?? `PRJ-${slugify(row.projectName ?? "sin-codigo").toUpperCase()}`;
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
        const businessUnit =
          row.businessUnit ??
          inferBusinessUnit((row.rawData as Record<string, unknown>).business_unit) ??
          BusinessUnit.PHARMA;
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
        const projectCode = buildProjectCode({
          projectCode: row.projectCode,
          projectName: null
        });
        const project = await projectsRepository.findByCode(projectCode);

        if (!project || !row.requestedDescription) {
          throw new Error("Project or requestedDescription not found");
        }

        const linkedMaterial = row.linkedMaterialCode
          ? await materialsMasterRepository.findByCode(row.linkedMaterialCode)
          : null;

        await materialRequestsRepository.upsert({
          sourceExternalId: `${projectCode}-${row.requestCode ?? row.rowNumber}`,
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
        const project = row.projectCode ? await projectsRepository.findByCode(row.projectCode) : null;

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
      for (const bomItem of project.bomItems) {
        const material = bomItem.expectedMaterialCode
          ? await materialsMasterRepository.findByCode(bomItem.expectedMaterialCode)
          : null;
        const request = await materialRequestsRepository.findLinkableRequest({
          projectId: project.id,
          linkedMaterialCode: bomItem.expectedMaterialCode,
          requestedDescription: bomItem.componentName
        });

        const item = await projectItemsRepository.upsert({
          projectId: project.id,
          itemKey: bomItem.componentKey,
          name: bomItem.componentName,
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

        const evaluation = await projectItemsService.recalculateProjectItem(item.id);
        summary.projectItemsUpserted += 1;
        summary.alertsRefreshed += evaluation.activeAlerts.length;
      }

      const existingItemKeys = new Set(project.projectItems.map((item) => item.itemKey));

      for (const request of project.materialRequests) {
        const provisionalItemKey = request.requestCode
          ? `REQ-${slugify(request.requestCode).toUpperCase()}`
          : `REQ-${slugify(request.requestedDescription).toUpperCase()}`;

        if (existingItemKeys.has(provisionalItemKey)) {
          continue;
        }

        if (project.bomItems.some((bomItem) => normalizeText(request.requestedDescription).includes(normalizeText(bomItem.componentName)))) {
          continue;
        }

        const item = await projectItemsRepository.upsert({
          projectId: project.id,
          itemKey: provisionalItemKey,
          name: request.requestedDescription,
          itemType: inferItemType(request.requestedDescription),
          criticality: ItemCriticality.HIGH,
          materialRequestId: request.id,
          materialMasterId: request.linkedMaterialId,
          expectedMaterialCode: request.linkedMaterialCode,
          requiresApprovedDocument: true,
          requiresMaterialCode: true,
          requiresTechnicalDocs: true
        });

        const evaluation = await projectItemsService.recalculateProjectItem(item.id);
        existingItemKeys.add(provisionalItemKey);
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
