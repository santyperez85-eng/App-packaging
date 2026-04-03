import { ItemCriticality, ItemType, ProjectItemStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { projectItemsRepository } from "@/server/repositories/project-items-repository";
import { alertsRepository } from "@/server/repositories/alerts-repository";
import { evaluateProjectItemRules } from "@/server/rules/project-item-rules";
import { projectsService } from "@/server/services/projects-service";

export const projectItemsService = {
  listProjectItems(filters?: { projectId?: string; status?: ProjectItemStatus }) {
    return projectItemsRepository.list({
      projectId: filters?.projectId,
      status: filters?.status
    });
  },

  async upsertProjectItem(payload: {
    projectId: string;
    itemKey: string;
    name: string;
    description?: string | null;
    itemType?: ItemType;
    criticality?: ItemCriticality;
    bomItemId?: string | null;
    materialRequestId?: string | null;
    materialMasterId?: string | null;
    expectedMaterialCode?: string | null;
    requiresApprovedDocument?: boolean;
    requiresMaterialCode?: boolean;
    requiresTechnicalDocs?: boolean;
  }) {
    const item = await projectItemsRepository.upsert(payload);
    await this.recalculateProjectItem(item.id);
    return prisma.projectItem.findUnique({
      where: { id: item.id },
      include: {
        project: true,
        materialMaster: true,
        bomItem: true,
        materialRequest: true,
        alerts: true,
        technicalChecks: true,
        moondeskTasks: {
          include: {
            documents: true,
            reviews: true
          }
        }
      }
    });
  },

  async recalculateProjectItem(projectItemId: string) {
    const item = await prisma.projectItem.findUnique({
      where: { id: projectItemId },
      include: {
        materialMaster: true,
        alerts: true,
        technicalChecks: true,
        moondeskTasks: {
          include: {
            documents: true,
            reviews: true
          }
        }
      }
    });

    if (!item) {
      throw new Error("Project item not found");
    }

    const evaluation = evaluateProjectItemRules(item);

    for (const alert of evaluation.activeAlerts) {
      await alertsRepository.upsertRuleAlert({
        projectId: item.projectId,
        projectItemId: item.id,
        type: alert.type,
        title: alert.title,
        message: alert.message,
        severity: alert.severity,
        ruleCode: alert.ruleCode
      });
    }

    await alertsRepository.resolveMissingRuleAlerts(
      item.id,
      evaluation.activeAlerts.map((alert) => alert.ruleCode)
    );

    await projectItemsRepository.updateStatusAndScore(item.id, evaluation.status, evaluation.readinessScore);
    await projectsService.recalculateProject(item.projectId);

    return evaluation;
  }
};
