import { Prisma, ProjectItemStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const projectItemsRepository = {
  list(where: Prisma.ProjectItemWhereInput = {}) {
    return prisma.projectItem.findMany({
      where,
      include: {
        project: true,
        materialMaster: true,
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
        technicalChecks: true
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
    return prisma.projectItem.upsert({
      where: {
        projectId_itemKey: {
          projectId: params.projectId,
          itemKey: params.itemKey
        }
      },
      update: {
        name: params.name,
        description: params.description ?? null,
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
      },
      create: {
        projectId: params.projectId,
        itemKey: params.itemKey,
        name: params.name,
        description: params.description ?? null,
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
