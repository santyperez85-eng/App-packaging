import { AlertStatus, MatchingStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { projectItemsService } from "@/server/services/project-items-service";
import { alertsService } from "@/server/services/alerts-service";
import { projectItemEvidencesRepository } from "@/server/repositories/project-item-evidences-repository";
import { projectItemsRepository } from "@/server/repositories/project-items-repository";

const REVIEW_MATCH_STATUSES: MatchingStatus[] = [MatchingStatus.AMBIGUOUS, MatchingStatus.MANUAL_REVIEW];

function evidenceRequestCode(sourceRecordKey: string) {
  const segments = sourceRecordKey.split(":");

  return segments.length ? segments[segments.length - 1] : null;
}

export const reviewService = {
  async getReviewQueue() {
    const [pendingBomConfirmations, evidenceReviews, candidateItems] = await Promise.all([
      prisma.alert.findMany({
        where: {
          status: AlertStatus.OPEN,
          ruleCode: "PRE_BOM_PENDING_CONFIRMATION"
        },
        include: {
          project: { select: { id: true, code: true, name: true } },
          projectItem: { select: { id: true, itemKey: true, name: true, componentSlot: true } }
        },
        orderBy: [{ createdAt: "asc" }]
      }),
      prisma.projectItemEvidence.findMany({
        where: {
          matchStatus: { in: REVIEW_MATCH_STATUSES },
          manualMatchStatus: null
        },
        include: {
          projectItem: {
            select: {
              id: true,
              itemKey: true,
              name: true,
              componentSlot: true,
              project: { select: { id: true, code: true, name: true } }
            }
          }
        },
        orderBy: [{ createdAt: "asc" }]
      }),
      prisma.projectItem.findMany({
        where: {
          materialRequestLockedAt: null,
          evidences: {
            some: { sourceType: "material_request" }
          }
        },
        include: {
          project: { select: { id: true, code: true, name: true } },
          materialRequest: { select: { id: true, requestCode: true, requestedDescription: true } },
          evidences: {
            where: { sourceType: "material_request" },
            orderBy: [{ sourceRecordKey: "asc" }]
          }
        }
      })
    ]);

    const competingMaterialRequests = [] as Array<{
      projectItem: {
        id: string;
        itemKey: string;
        name: string;
        componentSlot: string;
        project: { id: string; code: string; name: string };
      };
      linkedRequest: { id: string; requestCode: string | null; requestedDescription: string } | null;
      candidates: Array<{
        materialRequestId: string | null;
        requestCode: string | null;
        requestedDescription: string | null;
        evidenceSourceRecordKey: string;
        isCurrentLink: boolean;
      }>;
    }>;

    for (const item of candidateItems) {
      if (item.evidences.length < 2) {
        continue;
      }

      const requestCodes = item.evidences
        .map((evidence) => evidenceRequestCode(evidence.sourceRecordKey))
        .filter((code): code is string => Boolean(code));
      const requests = await prisma.materialRequest.findMany({
        where: {
          projectId: item.projectId,
          requestCode: { in: requestCodes }
        },
        select: { id: true, requestCode: true, requestedDescription: true }
      });
      const requestsByCode = new Map(requests.map((request) => [request.requestCode ?? "", request]));

      competingMaterialRequests.push({
        projectItem: {
          id: item.id,
          itemKey: item.itemKey,
          name: item.name,
          componentSlot: String(item.componentSlot),
          project: item.project
        },
        linkedRequest: item.materialRequest,
        candidates: item.evidences.map((evidence) => {
          const code = evidenceRequestCode(evidence.sourceRecordKey);
          const request = code ? (requestsByCode.get(code) ?? null) : null;

          return {
            materialRequestId: request?.id ?? null,
            requestCode: request?.requestCode ?? code,
            requestedDescription: request?.requestedDescription ?? evidence.rawLabel,
            evidenceSourceRecordKey: evidence.sourceRecordKey,
            isCurrentLink: Boolean(request && item.materialRequest && request.id === item.materialRequest.id)
          };
        })
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      pendingBomConfirmations: pendingBomConfirmations.map((alert) => ({
        alertId: alert.id,
        title: alert.title,
        message: alert.message,
        severity: alert.severity,
        createdAt: alert.createdAt.toISOString(),
        project: alert.project,
        projectItem: alert.projectItem
          ? { ...alert.projectItem, componentSlot: String(alert.projectItem.componentSlot) }
          : null
      })),
      evidenceReviews: evidenceReviews.map((evidence) => ({
        evidenceId: evidence.id,
        sourceType: evidence.sourceType,
        sourceRecordKey: evidence.sourceRecordKey,
        rawLabel: evidence.rawLabel,
        matchRule: evidence.matchRule,
        matchConfidence: evidence.matchConfidence,
        matchStatus: evidence.matchStatus,
        projectItem: {
          ...evidence.projectItem,
          componentSlot: String(evidence.projectItem.componentSlot)
        }
      })),
      competingMaterialRequests
    };
  },

  async confirmEvidence(params: { evidenceId: string; note?: string | null }) {
    const evidence = await projectItemEvidencesRepository.setManualMatchDecision({
      evidenceId: params.evidenceId,
      manualMatchStatus: MatchingStatus.EXACT,
      note: params.note
    });

    await projectItemsService.recalculateProjectItem(evidence.projectItemId);

    return evidence;
  },

  async confirmPendingBom(params: { alertId: string; note?: string | null }) {
    return alertsService.resolveAlert(params.alertId, { manual: true, note: params.note });
  },

  async linkMaterialRequest(params: { projectItemId: string; materialRequestId: string; note?: string | null }) {
    const item = await projectItemsRepository.setManualMaterialRequestLink({
      projectItemId: params.projectItemId,
      materialRequestId: params.materialRequestId,
      note: params.note
    });

    await projectItemsService.recalculateProjectItem(item.id);

    return item;
  }
};
