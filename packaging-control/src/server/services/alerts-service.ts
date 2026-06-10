import { Prisma } from "@prisma/client";
import { AlertStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { isMockPreviewEnabled, mockData } from "@/server/mock-data";
import { alertsRepository } from "@/server/repositories/alerts-repository";
import { projectItemsService } from "@/server/services/project-items-service";

export const alertsService = {
  listAlerts(filters?: { projectId?: string; projectItemId?: string; status?: AlertStatus }) {
    if (isMockPreviewEnabled()) {
      return Promise.resolve(
        mockData.alerts.filter((alert) => {
          if (filters?.status && alert.status !== filters.status) {
            return false;
          }

          if (filters?.projectId) {
            const project = mockData.projects.find((item) => item.id === filters.projectId);
            if (!project || alert.project?.code !== project.code) {
              return false;
            }
          }

          if (filters?.projectItemId && alert.projectItem?.name !== mockData.projectItems.find((item) => item.id === filters.projectItemId)?.name) {
            return false;
          }

          return true;
        })
      );
    }

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

  async resolveAlert(alertId: string, options?: { manual?: boolean; note?: string | null }) {
    const alert = await prisma.alert.update({
      where: { id: alertId },
      data: {
        status: AlertStatus.RESOLVED,
        resolvedAt: new Date(),
        // La marca manual evita que la proxima consolidacion reabra la alerta
        // mientras la condicion subyacente siga igual.
        manuallyResolved: options?.manual ?? false,
        resolutionNote: options?.note ?? null
      }
    });

    if (alert.projectItemId) {
      await projectItemsService.recalculateProjectItem(alert.projectItemId);
    }

    return alert;
  }
};
