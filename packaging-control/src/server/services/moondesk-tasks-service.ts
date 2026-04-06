import { MoondeskTaskStatus } from "@prisma/client";

import { isMockPreviewEnabled, mockData } from "@/server/mock-data";
import { moondeskTasksRepository } from "@/server/repositories/moondesk-tasks-repository";
import { projectItemsService } from "@/server/services/project-items-service";

export const moondeskTasksService = {
  listMoondeskTasks(filters?: { projectItemId?: string; taskStatus?: MoondeskTaskStatus }) {
    if (isMockPreviewEnabled()) {
      return Promise.resolve(
        mockData.moondeskTasks.filter((task) => {
          if (filters?.projectItemId && task.projectItemId !== filters.projectItemId) {
            return false;
          }

          if (filters?.taskStatus && task.taskStatus !== filters.taskStatus) {
            return false;
          }

          return true;
        })
      );
    }

    return moondeskTasksRepository.list({
      projectItemId: filters?.projectItemId,
      taskStatus: filters?.taskStatus
    });
  },

  async upsertMoondeskTask(payload: Parameters<typeof moondeskTasksRepository.upsert>[0]) {
    const task = await moondeskTasksRepository.upsert(payload);
    await projectItemsService.recalculateProjectItem(task.projectItemId);
    return task;
  }
};
