import { MaterialType } from "@prisma/client";

import { materialsMasterRepository } from "@/server/repositories/materials-master-repository";

export const materialsMasterService = {
  listMaterials(filters?: { materialType?: MaterialType }) {
    return materialsMasterRepository.list({
      materialType: filters?.materialType
    });
  },

  upsertMaterial(payload: Parameters<typeof materialsMasterRepository.upsert>[0]) {
    return materialsMasterRepository.upsert(payload);
  }
};
