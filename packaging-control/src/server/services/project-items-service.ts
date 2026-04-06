import {
  ApplicabilityStatus,
  ComponentSlot,
  ItemCriticality,
  ItemType,
  MatchingStatus,
  ProjectItemExpectedStatus,
  ProjectItemIdentificationStatus,
  ProjectItemOriginMode,
  ProjectItemStatus
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { isMockPreviewEnabled, mockData } from "@/server/mock-data";
import { projectItemsRepository } from "@/server/repositories/project-items-repository";
import { alertsRepository } from "@/server/repositories/alerts-repository";
import { evaluateProjectItemRules } from "@/server/rules/project-item-rules";
import { projectsService } from "@/server/services/projects-service";

export const projectItemsService = {
  listProjectItems(filters?: { projectId?: string; status?: ProjectItemStatus }) {
    if (isMockPreviewEnabled()) {
      return Promise.resolve(
        mockData.projectItems.filter((item) => {
          if (filters?.projectId && item.projectId !== filters.projectId) {
            return false;
          }

          if (filters?.status && item.status !== filters.status) {
            return false;
          }

          return true;
        })
      );
    }

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
    componentSlot?: ComponentSlot;
    applicabilityStatus?: ApplicabilityStatus;
    originMode?: ProjectItemOriginMode;
    provisional?: boolean;
    expectedStatus?: ProjectItemExpectedStatus;
    identificationStatus?: ProjectItemIdentificationStatus;
    matchingStatus?: MatchingStatus;
    provisionalCode?: string | null;
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
        evidences: true,
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
        project: true,
        bomItem: true,
        materialRequest: true,
        materialMaster: {
          include: {
            sapMaterial: true
          }
        },
        alerts: true,
        evidences: true,
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
        ruleCode: alert.ruleCode,
        metadata: alert.metadata
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
