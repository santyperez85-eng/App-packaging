import { AlertSeverity, AlertStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const alertsRepository = {
  list(where: Prisma.AlertWhereInput = {}) {
    return prisma.alert.findMany({
      where,
      include: {
        project: true,
        projectItem: {
          include: {
            materialMaster: true
          }
        }
      },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }]
    });
  },

  openCriticalCountForProject(projectId: string) {
    return prisma.alert.count({
      where: {
        projectId,
        status: AlertStatus.OPEN,
        severity: AlertSeverity.CRITICAL
      }
    });
  },

  async upsertRuleAlert(params: {
    projectId?: string | null;
    projectItemId: string;
    type: string;
    title: string;
    message: string;
    severity: AlertSeverity;
    ruleCode: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    const existing = await prisma.alert.findUnique({
      where: {
        projectItemId_ruleCode: {
          projectItemId: params.projectItemId,
          ruleCode: params.ruleCode
        }
      }
    });

    // Una resolucion manual sobrevive mientras la condicion siga igual:
    // se refresca el contenido pero no se reabre la alerta.
    if (existing?.manuallyResolved && existing.status === AlertStatus.RESOLVED) {
      return prisma.alert.update({
        where: { id: existing.id },
        data: {
          projectId: params.projectId ?? null,
          type: params.type,
          title: params.title,
          message: params.message,
          severity: params.severity,
          metadata: params.metadata
        }
      });
    }

    return prisma.alert.upsert({
      where: {
        projectItemId_ruleCode: {
          projectItemId: params.projectItemId,
          ruleCode: params.ruleCode
        }
      },
      update: {
        projectId: params.projectId ?? null,
        type: params.type,
        title: params.title,
        message: params.message,
        severity: params.severity,
        status: AlertStatus.OPEN,
        metadata: params.metadata
      },
      create: {
        projectId: params.projectId ?? null,
        projectItemId: params.projectItemId,
        type: params.type,
        title: params.title,
        message: params.message,
        severity: params.severity,
        status: AlertStatus.OPEN,
        ruleCode: params.ruleCode,
        metadata: params.metadata
      }
    });
  },

  async resolveMissingRuleAlerts(projectItemId: string, activeRuleCodes: string[]) {
    const resolved = await prisma.alert.updateMany({
      where: {
        projectItemId,
        status: AlertStatus.OPEN,
        ruleCode: {
          not: null
        },
        NOT: {
          ruleCode: {
            in: activeRuleCodes
          }
        }
      },
      data: {
        status: AlertStatus.RESOLVED,
        resolvedAt: new Date()
      }
    });

    // Si la condicion dejo de cumplirse, la marca manual ya no es necesaria:
    // un futuro re-disparo de la regla debe reabrir la alerta.
    await prisma.alert.updateMany({
      where: {
        projectItemId,
        manuallyResolved: true,
        ruleCode: {
          not: null,
          notIn: activeRuleCodes
        }
      },
      data: {
        manuallyResolved: false
      }
    });

    return resolved;
  }
};
