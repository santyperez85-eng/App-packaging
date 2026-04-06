import { Prisma, ProjectStatus, ScopeDefinedStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const projectsRepository = {
  list(where: Prisma.ProjectWhereInput = {}) {
    return prisma.project.findMany({
      where,
      include: {
        product: true,
        _count: {
          select: {
            projectItems: true,
            alerts: true
          }
        }
      },
      orderBy: [{ targetLaunchDate: "asc" }, { updatedAt: "desc" }]
    });
  },

  findById(projectId: string) {
    return prisma.project.findUnique({
      where: { id: projectId },
      include: {
        product: true,
        owner: true,
        projectItems: {
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
              where: { status: "OPEN" },
              orderBy: [{ severity: "desc" }, { createdAt: "desc" }]
            },
            evidences: {
              orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }]
            },
            moondeskTasks: {
              include: {
                documents: true,
                reviews: true
              },
              orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }]
            },
            technicalChecks: true
          },
          orderBy: [{ criticality: "desc" }, { updatedAt: "desc" }]
        },
        bomItems: {
          orderBy: { componentName: "asc" }
        },
        materialRequests: {
          include: {
            linkedMaterial: true
          },
          orderBy: { requestDate: "desc" }
        },
        alerts: {
          where: { status: "OPEN" },
          orderBy: [{ severity: "desc" }, { createdAt: "desc" }]
        }
      }
    });
  },

  findByCode(code: string) {
    return prisma.project.findUnique({
      where: { code }
    });
  },

  async upsert(params: {
    code: string;
    name: string;
    businessUnit: Prisma.ProjectCreateInput["businessUnit"];
    caseType?: string | null;
    changeDriver?: string | null;
    presentation?: string | null;
    activeIngredient?: string | null;
    sapFinishedCode?: string | null;
    scopeDefined?: ScopeDefinedStatus;
    productId?: string | null;
    ownerId?: string | null;
    sourcePmKey?: string | null;
    description?: string | null;
    macroStatus?: string | null;
    startDate?: Date | null;
    targetLaunchDate?: Date | null;
    status?: ProjectStatus;
    healthScore?: number;
  }) {
    const existing = await prisma.project.findUnique({
      where: { code: params.code }
    });

    const payload = {
      code: params.code,
      name: params.name,
      businessUnit: params.businessUnit,
      caseType: params.caseType ?? null,
      changeDriver: params.changeDriver ?? null,
      presentation: params.presentation ?? null,
      activeIngredient: params.activeIngredient ?? null,
      sapFinishedCode: params.sapFinishedCode ?? null,
      scopeDefined: params.scopeDefined ?? ScopeDefinedStatus.UNKNOWN,
      productId: params.productId ?? null,
      ownerId: params.ownerId ?? null,
      sourcePmKey: params.sourcePmKey ?? null,
      description: params.description ?? null,
      macroStatus: params.macroStatus ?? null,
      startDate: params.startDate ?? null,
      targetLaunchDate: params.targetLaunchDate ?? null,
      status: params.status ?? ProjectStatus.ACTIVE,
      healthScore: params.healthScore ?? 0
    };

    if (existing) {
      return prisma.project.update({
        where: { id: existing.id },
        data: payload
      });
    }

    return prisma.project.create({
      data: payload
    });
  },

  updateHealthScore(projectId: string, healthScore: number) {
    return prisma.project.update({
      where: { id: projectId },
      data: { healthScore }
    });
  }
};
