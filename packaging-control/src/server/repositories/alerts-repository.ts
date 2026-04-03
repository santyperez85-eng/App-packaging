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

  upsertRuleAlert(params: {
    projectId?: string | null;
    projectItemId: string;
    type: string;
    title: string;
    message: string;
    severity: AlertSeverity;
    ruleCode: string;
    metadata?: Prisma.InputJsonValue;
  }) {
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

  resolveMissingRuleAlerts(projectItemId: string, activeRuleCodes: string[]) {
    return prisma.alert.updateMany({
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
  }
};
