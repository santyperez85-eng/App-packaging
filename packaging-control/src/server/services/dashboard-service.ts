import { AlertSeverity, AlertStatus, ProjectItemStatus, ProjectStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { isMockPreviewEnabled, mockData } from "@/server/mock-data";
import { projectsRepository } from "@/server/repositories/projects-repository";
import { alertsRepository } from "@/server/repositories/alerts-repository";

export const dashboardService = {
  async getExecutiveSnapshot() {
    if (isMockPreviewEnabled()) {
      return mockData.dashboard;
    }

    const [totalProjects, activeProjects, blockedProjects, totalItems, readyItems, openAlerts, criticalAlerts, atRiskProjects] =
      await Promise.all([
        prisma.project.count(),
        prisma.project.count({ where: { status: ProjectStatus.ACTIVE } }),
        prisma.project.count({ where: { status: ProjectStatus.BLOCKED } }),
        prisma.projectItem.count(),
        prisma.projectItem.count({ where: { status: ProjectItemStatus.READY } }),
        prisma.alert.count({ where: { status: AlertStatus.OPEN } }),
        prisma.alert.count({
          where: {
            status: AlertStatus.OPEN,
            severity: AlertSeverity.CRITICAL
          }
        }),
        projectsRepository.list({
          OR: [{ healthScore: { lt: 60 } }, { alerts: { some: { status: AlertStatus.OPEN, severity: AlertSeverity.CRITICAL } } }]
        })
      ]);

    const recentAlerts = await alertsRepository.list({
      status: AlertStatus.OPEN
    });

    return {
      totals: {
        totalProjects,
        activeProjects,
        blockedProjects,
        totalItems,
        readyItems,
        openAlerts,
        criticalAlerts
      },
      atRiskProjects: atRiskProjects.slice(0, 5),
      recentAlerts: recentAlerts.slice(0, 8)
    };
  }
};
