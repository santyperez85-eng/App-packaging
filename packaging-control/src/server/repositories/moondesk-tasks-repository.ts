import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const moondeskTasksRepository = {
  list(where: Prisma.MoondeskTaskWhereInput = {}) {
    return prisma.moondeskTask.findMany({
      where,
      include: {
        projectItem: {
          include: {
            project: true
          }
        },
        documents: true,
        versions: true,
        reviews: true
      },
      orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }]
    });
  },

  upsert(params: Prisma.MoondeskTaskUncheckedCreateInput) {
    if (params.externalTaskId) {
      return prisma.moondeskTask.upsert({
        where: { externalTaskId: params.externalTaskId },
        update: {
          ...params
        },
        create: params
      });
    }

    return prisma.moondeskTask.create({
      data: params
    });
  }
};
