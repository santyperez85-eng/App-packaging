import { MaterialRequestStatus } from "@prisma/client";

import { materialRequestsRepository } from "@/server/repositories/material-requests-repository";

export const materialRequestsService = {
  listMaterialRequests(filters?: { projectId?: string; requestStatus?: MaterialRequestStatus }) {
    return materialRequestsRepository.list({
      projectId: filters?.projectId,
      requestStatus: filters?.requestStatus
    });
  },

  upsertMaterialRequest(payload: Parameters<typeof materialRequestsRepository.upsert>[0]) {
    return materialRequestsRepository.upsert(payload);
  }
};
