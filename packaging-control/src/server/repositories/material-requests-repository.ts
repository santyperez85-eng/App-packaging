import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const materialRequestsRepository = {
  list(where: Prisma.MaterialRequestWhereInput = {}) {
    return prisma.materialRequest.findMany({
      where,
      include: {
        project: true,
        linkedMaterial: true
      },
      orderBy: [{ requestDate: "desc" }, { updatedAt: "desc" }]
    });
  },

  findLinkableRequest(params: {
    projectId: string;
    linkedMaterialCode?: string | null;
    requestedDescription?: string | null;
  }) {
    return prisma.materialRequest.findFirst({
      where: {
        projectId: params.projectId,
        OR: [
          params.linkedMaterialCode
            ? {
                linkedMaterialCode: params.linkedMaterialCode
              }
            : undefined,
          params.requestedDescription
            ? {
                requestedDescription: {
                  contains: params.requestedDescription,
                  mode: "insensitive"
                }
              }
            : undefined
        ].filter(Boolean) as Prisma.MaterialRequestWhereInput[]
      },
      orderBy: { requestDate: "desc" }
    });
  },

  upsert(params: {
    sourceExternalId?: string | null;
    requestCode?: string | null;
    projectId: string;
    requestedDescription: string;
    requestDate?: Date | null;
    requestedById?: string | null;
    requestedByName?: string | null;
    materialType?: Prisma.MaterialRequestUncheckedCreateInput["materialType"];
    requestStatus?: Prisma.MaterialRequestUncheckedCreateInput["requestStatus"];
    linkedMaterialCode?: string | null;
    linkedMaterialId?: string | null;
    notes?: string | null;
  }) {
    if (params.sourceExternalId) {
      return prisma.materialRequest.upsert({
        where: { sourceExternalId: params.sourceExternalId },
        update: {
          requestCode: params.requestCode ?? null,
          projectId: params.projectId,
          requestedDescription: params.requestedDescription,
          requestDate: params.requestDate ?? null,
          requestedById: params.requestedById ?? null,
          requestedByName: params.requestedByName ?? null,
          materialType: params.materialType,
          requestStatus: params.requestStatus,
          linkedMaterialCode: params.linkedMaterialCode ?? null,
          linkedMaterialId: params.linkedMaterialId ?? null,
          notes: params.notes ?? null
        },
        create: {
          sourceExternalId: params.sourceExternalId,
          requestCode: params.requestCode ?? null,
          projectId: params.projectId,
          requestedDescription: params.requestedDescription,
          requestDate: params.requestDate ?? null,
          requestedById: params.requestedById ?? null,
          requestedByName: params.requestedByName ?? null,
          materialType: params.materialType,
          requestStatus: params.requestStatus,
          linkedMaterialCode: params.linkedMaterialCode ?? null,
          linkedMaterialId: params.linkedMaterialId ?? null,
          notes: params.notes ?? null
        }
      });
    }

    return prisma.materialRequest.create({
      data: {
        requestCode: params.requestCode ?? null,
        projectId: params.projectId,
        requestedDescription: params.requestedDescription,
        requestDate: params.requestDate ?? null,
        requestedById: params.requestedById ?? null,
        requestedByName: params.requestedByName ?? null,
        materialType: params.materialType,
        requestStatus: params.requestStatus,
        linkedMaterialCode: params.linkedMaterialCode ?? null,
        linkedMaterialId: params.linkedMaterialId ?? null,
        notes: params.notes ?? null
      }
    });
  }
};
