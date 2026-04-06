import { BusinessUnit, ProjectStatus, ScopeDefinedStatus } from "@prisma/client";

import { isMockPreviewEnabled, mockData } from "@/server/mock-data";
import { projectsRepository } from "@/server/repositories/projects-repository";
import { evaluateProjectHealth, canCloseProject } from "@/server/rules/project-rules";

export const projectsService = {
  listProjects(filters?: { status?: ProjectStatus; businessUnit?: BusinessUnit }) {
    if (isMockPreviewEnabled()) {
      return Promise.resolve(
        mockData.projects.filter((project) => {
          if (filters?.status && project.status !== filters.status) {
            return false;
          }

          if (filters?.businessUnit) {
            return false;
          }

          return true;
        })
      );
    }

    return projectsRepository.list({
      status: filters?.status,
      businessUnit: filters?.businessUnit
    });
  },

  async getProjectDetail(projectId: string) {
    if (isMockPreviewEnabled()) {
      const project = mockData.projectDetails[projectId as keyof typeof mockData.projectDetails];

      if (!project) {
        throw new Error("Project not found");
      }

      return project;
    }

    const project = await projectsRepository.findById(projectId);

    if (!project) {
      throw new Error("Project not found");
    }

    return project;
  },

  async upsertProject(payload: {
    code: string;
    name: string;
    businessUnit: BusinessUnit;
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
  }) {
    const existing = await projectsRepository.findByCode(payload.code);

    if (payload.status === ProjectStatus.CLOSED && existing) {
      const existingProject = await projectsRepository.findById(existing.id);

      if (existingProject && !canCloseProject(existingProject)) {
        throw new Error("Project cannot be closed while critical project_items remain incomplete.");
      }
    }

    return projectsRepository.upsert(payload);
  },

  async recalculateProject(projectId: string) {
    const project = await projectsRepository.findById(projectId);

    if (!project) {
      throw new Error("Project not found");
    }

    const healthScore = evaluateProjectHealth(project);
    await projectsRepository.updateHealthScore(projectId, healthScore);

    return {
      projectId,
      healthScore,
      canClose: canCloseProject(project)
    };
  }
};
