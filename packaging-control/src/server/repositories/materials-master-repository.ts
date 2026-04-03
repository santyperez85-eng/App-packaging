import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const materialsMasterRepository = {
  list(where: Prisma.MaterialsMasterWhereInput = {}) {
    return prisma.materialsMaster.findMany({
      where,
      include: {
        _count: {
          select: {
            projectItems: true
          }
        }
      },
      orderBy: [{ updatedAt: "desc" }]
    });
  },

  findByCode(materialCode: string) {
    return prisma.materialsMaster.findUnique({
      where: { materialCode }
    });
  },

  upsert(params: Prisma.MaterialsMasterUncheckedCreateInput) {
    return prisma.materialsMaster.upsert({
      where: { materialCode: params.materialCode },
      update: {
        ...params
      },
      create: params
    });
  }
};
