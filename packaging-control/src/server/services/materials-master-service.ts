import { MaterialType } from "@prisma/client";

import { isMockPreviewEnabled, mockData } from "@/server/mock-data";
import { materialsMasterRepository } from "@/server/repositories/materials-master-repository";

export const materialsMasterService = {
  listMaterials(filters?: { materialType?: MaterialType }) {
    if (isMockPreviewEnabled()) {
      return Promise.resolve(
        mockData.materials.filter((material) => {
          if (filters?.materialType && material.materialType !== filters.materialType) {
            return false;
          }

          return true;
        })
      );
    }

    return materialsMasterRepository.list({
      materialType: filters?.materialType
    });
  },

  upsertMaterial(payload: Parameters<typeof materialsMasterRepository.upsert>[0]) {
    return materialsMasterRepository.upsert(payload);
  }
};
