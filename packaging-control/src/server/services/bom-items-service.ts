import { isMockPreviewEnabled, mockData } from "@/server/mock-data";
import { bomItemsRepository } from "@/server/repositories/bom-items-repository";

export const bomItemsService = {
  listBomItems(filters?: { projectId?: string }) {
    if (isMockPreviewEnabled()) {
      return Promise.resolve(
        Object.values(mockData.projectDetails)
          .filter((project) => !filters?.projectId || (project as { id: string }).id === filters.projectId)
          .flatMap((project) => (project as { bomItems: unknown[] }).bomItems)
      );
    }

    return bomItemsRepository.list({
      projectId: filters?.projectId
    });
  },

  upsertBomItem(payload: Parameters<typeof bomItemsRepository.upsert>[0]) {
    return bomItemsRepository.upsert(payload);
  }
};
