import { AlertSeverity, AlertStatus, Prisma, ProjectItemStatus } from "@prisma/client";

import { clampScore } from "@/lib/utils";

export type ProjectHealthRecord = Prisma.ProjectGetPayload<{
  include: {
    projectItems: true;
    alerts: true;
  };
}>;

export function evaluateProjectHealth(project: ProjectHealthRecord) {
  const averageReadiness =
    project.projectItems.length === 0
      ? 0
      : project.projectItems.reduce((total, item) => total + item.readinessScore, 0) / project.projectItems.length;
  const criticalAlerts = project.alerts.filter(
    (alert) => alert.status === AlertStatus.OPEN && alert.severity === AlertSeverity.CRITICAL
  ).length;
  const warningAlerts = project.alerts.filter(
    (alert) => alert.status === AlertStatus.OPEN && alert.severity === AlertSeverity.WARNING
  ).length;

  return clampScore(averageReadiness - criticalAlerts * 12 - warningAlerts * 5);
}

export function canCloseProject(project: ProjectHealthRecord) {
  return !project.projectItems.some(
    (item) => item.criticality === "CRITICAL" && item.status !== ProjectItemStatus.READY
  );
}
