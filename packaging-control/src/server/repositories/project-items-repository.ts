import {
  ApplicabilityStatus,
  ComponentSlot,
  MatchingStatus,
  Prisma,
  ProjectItemExpectedStatus,
  ProjectItemIdentificationStatus,
  ProjectItemOriginMode,
  ProjectItemStatus
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const projectItemsRepository = {
  list(where: Prisma.ProjectItemWhereInput = {}) {
    return prisma.projectItem.findMany({
      where,
      include: {
        project: true,
        materialMaster: {
          include: {
            sapMaterial: true
          }
        },
        bomItem: true,
        materialRequest: true,
        alerts: {
          where: { status: "OPEN" }
        },
        moondeskTasks: {
          include: {
            documents: true,
            reviews: true
          }
        },
        technicalChecks: true,
        evidences: true
      },
      orderBy: [{ updatedAt: "desc" }]
    });
  },

  findByProjectAndItemKey(projectId: string, itemKey: string) {
    return prisma.projectItem.findUnique({
      where: {
        projectId_itemKey: {
          projectId,
          itemKey
        }
      }
    });
  },

  upsert(params: {
    projectId: string;
    itemKey: string;
    name: string;
    description?: string | null;
    componentSlot?: ComponentSlot;
    applicabilityStatus?: ApplicabilityStatus;
    originMode?: ProjectItemOriginMode;
    provisional?: boolean;
    expectedStatus?: ProjectItemExpectedStatus;
    identificationStatus?: ProjectItemIdentificationStatus;
    matchingStatus?: MatchingStatus;
    provisionalCode?: string | null;
    itemType?: Prisma.ProjectItemUncheckedCreateInput["itemType"];
    criticality?: Prisma.ProjectItemUncheckedCreateInput["criticality"];
    status?: ProjectItemStatus;
    readinessScore?: number;
    bomItemId?: string | null;
    materialRequestId?: string | null;
    materialMasterId?: string | null;
    expectedMaterialCode?: string | null;
    requiresApprovedDocument?: boolean;
    requiresMaterialCode?: boolean;
    requiresTechnicalDocs?: boolean;
  }) {
    const updateData: Prisma.ProjectItemUpdateInput = {
      name: params.name
    };

    if (params.description !== undefined) updateData.description = params.description;
    if (params.componentSlot !== undefined) updateData.componentSlot = params.componentSlot;
    if (params.applicabilityStatus !== undefined) updateData.applicabilityStatus = params.applicabilityStatus;
    if (params.originMode !== undefined) updateData.originMode = params.originMode;
    if (params.provisional !== undefined) updateData.provisional = params.provisional;
    if (params.expectedStatus !== undefined) updateData.expectedStatus = params.expectedStatus;
    if (params.identificationStatus !== undefined) updateData.identificationStatus = params.identificationStatus;
    if (params.matchingStatus !== undefined) updateData.matchingStatus = params.matchingStatus;
    if (params.provisionalCode !== undefined) updateData.provisionalCode = params.provisionalCode;
    if (params.itemType !== undefined) updateData.itemType = params.itemType;
    if (params.criticality !== undefined) updateData.criticality = params.criticality;
    if (params.status !== undefined) updateData.status = params.status;
    if (params.readinessScore !== undefined) updateData.readinessScore = params.readinessScore;
    if (params.bomItemId !== undefined) updateData.bomItem = params.bomItemId ? { connect: { id: params.bomItemId } } : { disconnect: true };
    if (params.materialRequestId !== undefined) {
      updateData.materialRequest = params.materialRequestId
        ? { connect: { id: params.materialRequestId } }
        : { disconnect: true };
    }
    if (params.materialMasterId !== undefined) {
      updateData.materialMaster = params.materialMasterId
        ? { connect: { id: params.materialMasterId } }
        : { disconnect: true };
    }
    if (params.expectedMaterialCode !== undefined) updateData.expectedMaterialCode = params.expectedMaterialCode;
    if (params.requiresApprovedDocument !== undefined) {
      updateData.requiresApprovedDocument = params.requiresApprovedDocument;
    }
    if (params.requiresMaterialCode !== undefined) updateData.requiresMaterialCode = params.requiresMaterialCode;
    if (params.requiresTechnicalDocs !== undefined) updateData.requiresTechnicalDocs = params.requiresTechnicalDocs;

    return prisma.projectItem.upsert({
      where: {
        projectId_itemKey: {
          projectId: params.projectId,
          itemKey: params.itemKey
        }
      },
      update: updateData,
      create: {
        projectId: params.projectId,
        itemKey: params.itemKey,
        name: params.name,
        description: params.description ?? null,
        componentSlot: params.componentSlot,
        applicabilityStatus: params.applicabilityStatus,
        originMode: params.originMode,
        provisional: params.provisional,
        expectedStatus: params.expectedStatus,
        identificationStatus: params.identificationStatus,
        matchingStatus: params.matchingStatus,
        provisionalCode: params.provisionalCode ?? null,
        itemType: params.itemType,
        criticality: params.criticality,
        status: params.status,
        readinessScore: params.readinessScore,
        bomItemId: params.bomItemId ?? null,
        materialRequestId: params.materialRequestId ?? null,
        materialMasterId: params.materialMasterId ?? null,
        expectedMaterialCode: params.expectedMaterialCode ?? null,
        requiresApprovedDocument: params.requiresApprovedDocument,
        requiresMaterialCode: params.requiresMaterialCode,
        requiresTechnicalDocs: params.requiresTechnicalDocs
      }
    });
  },

  updateStatusAndScore(projectItemId: string, status: ProjectItemStatus, readinessScore: number) {
    return prisma.projectItem.update({
      where: { id: projectItemId },
      data: {
        status,
        readinessScore
      }
    });
  }
};
