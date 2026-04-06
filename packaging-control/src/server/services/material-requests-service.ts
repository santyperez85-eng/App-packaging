import { MaterialRequestStatus } from "@prisma/client";

import { isMockPreviewEnabled, mockData } from "@/server/mock-data";
import { materialRequestsRepository } from "@/server/repositories/material-requests-repository";

export const materialRequestsService = {
  listMaterialRequests(filters?: { projectId?: string; requestStatus?: MaterialRequestStatus }) {
    if (isMockPreviewEnabled()) {
      const requests = Object.values(mockData.projectDetails).flatMap(
        (project) =>
          (project as { materialRequests: Array<{ requestStatus: MaterialRequestStatus }> }).materialRequests
      );

      return Promise.resolve(
        requests.filter((request) => {
          if (filters?.requestStatus && request.requestStatus !== filters.requestStatus) {
            return false;
          }

          return true;
        })
      );
    }

    return materialRequestsRepository.list({
      projectId: filters?.projectId,
      requestStatus: filters?.requestStatus
    });
  },

  upsertMaterialRequest(payload: Parameters<typeof materialRequestsRepository.upsert>[0]) {
    return materialRequestsRepository.upsert(payload);
  }
};
