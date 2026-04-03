import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const bomItemsRepository = {
  list(where: Prisma.BomItemWhereInput = {}) {
    return prisma.bomItem.findMany({
      where,
      include: {
        project: true,
        projectItems: true
      },
      orderBy: [{ updatedAt: "desc" }]
    });
  },

  listPackagingByProject(projectId: string) {
    return prisma.bomItem.findMany({
      where: {
        projectId,
        isPackaging: true
      },
      orderBy: { componentName: "asc" }
    });
  },

  upsert(params: {
    projectId: string;
    componentKey: string;
    componentName: string;
    componentType?: Prisma.BomItemUncheckedCreateInput["componentType"];
    quantity?: number | null;
    unit?: string | null;
    isPackaging?: boolean;
    isCritical?: boolean;
    expectedMaterialCode?: string | null;
    notes?: string | null;
  }) {
    return prisma.bomItem.upsert({
      where: {
        projectId_componentKey: {
          projectId: params.projectId,
          componentKey: params.componentKey
        }
      },
      update: {
        componentName: params.componentName,
        componentType: params.componentType,
        quantity: params.quantity ?? null,
        unit: params.unit ?? null,
        isPackaging: params.isPackaging,
        isCritical: params.isCritical,
        expectedMaterialCode: params.expectedMaterialCode ?? null,
        notes: params.notes ?? null
      },
      create: {
        projectId: params.projectId,
        componentKey: params.componentKey,
        componentName: params.componentName,
        componentType: params.componentType,
        quantity: params.quantity ?? null,
        unit: params.unit ?? null,
        isPackaging: params.isPackaging,
        isCritical: params.isCritical,
        expectedMaterialCode: params.expectedMaterialCode ?? null,
        notes: params.notes ?? null
      }
    });
  }
};
