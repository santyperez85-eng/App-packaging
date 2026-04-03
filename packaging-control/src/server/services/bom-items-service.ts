import { bomItemsRepository } from "@/server/repositories/bom-items-repository";

export const bomItemsService = {
  listBomItems(filters?: { projectId?: string }) {
    return bomItemsRepository.list({
      projectId: filters?.projectId
    });
  },

  upsertBomItem(payload: Parameters<typeof bomItemsRepository.upsert>[0]) {
    return bomItemsRepository.upsert(payload);
  }
};
