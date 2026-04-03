import { MoondeskTaskStatus } from "@prisma/client";

import { moondeskTasksRepository } from "@/server/repositories/moondesk-tasks-repository";
import { projectItemsService } from "@/server/services/project-items-service";

export const moondeskTasksService = {
  listMoondeskTasks(filters?: { projectItemId?: string; taskStatus?: MoondeskTaskStatus }) {
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
