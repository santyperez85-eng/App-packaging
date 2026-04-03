import { Prisma } from "@prisma/client";
import { AlertStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { alertsRepository } from "@/server/repositories/alerts-repository";
import { projectItemsService } from "@/server/services/project-items-service";

export const alertsService = {
  listAlerts(filters?: { projectId?: string; projectItemId?: string; status?: AlertStatus }) {
    return alertsRepository.list({
      projectId: filters?.projectId,
      projectItemId: filters?.projectItemId,
      status: filters?.status
    });
  },

  createAlert(payload: {
    projectId?: string | null;
    projectItemId?: string | null;
    type: string;
    title: string;
    message: string;
    severity?: "INFO" | "WARNING" | "CRITICAL";
    ruleCode?: string | null;
    dueDate?: Date | null;
    metadata?: Record<string, unknown>;
  }) {
    return prisma.alert.create({
      data: {
        projectId: payload.projectId ?? null,
        projectItemId: payload.projectItemId ?? null,
        type: payload.type,
        title: payload.title,
        message: payload.message,
        severity: payload.severity,
        ruleCode: payload.ruleCode ?? null,
        dueDate: payload.dueDate ?? null,
        metadata: payload.metadata
          ? (JSON.parse(JSON.stringify(payload.metadata)) as Prisma.InputJsonObject)
          : undefined
      }
    });
  },

  async resolveAlert(alertId: string) {
    const alert = await prisma.alert.update({
      where: { id: alertId },
      data: {
        status: AlertStatus.RESOLVED,
        resolvedAt: new Date()
      }
    });

    if (alert.projectItemId) {
      await projectItemsService.recalculateProjectItem(alert.projectItemId);
    }

    return alert;
  }
};
