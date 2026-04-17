import { MatchConfidence, MatchingStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

function normalizeRawData(rawData: Prisma.InputJsonValue | null | undefined) {
  if (rawData === undefined) {
    return undefined;
  }

  return rawData === null ? Prisma.JsonNull : rawData;
}

export const projectItemEvidencesRepository = {
  async upsert(params: {
    projectItemId: string;
    sourceType: string;
    sourceRecordKey: string;
    matchRule?: string | null;
    matchConfidence?: MatchConfidence;
    matchStatus?: MatchingStatus;
    isPrimary?: boolean;
    lastSeenAt?: Date | null;
    rawLabel?: string | null;
    rawData?: Prisma.InputJsonValue | null;
  }) {
    const rawData = normalizeRawData(params.rawData);
    const projectItem = await prisma.projectItem.findUnique({
      where: { id: params.projectItemId },
      select: { projectId: true }
    });

    if (!projectItem) {
      throw new Error("Project item not found");
    }

    const conflictingMappings = await prisma.projectItemEvidence.findMany({
      where: {
        sourceType: params.sourceType,
        sourceRecordKey: params.sourceRecordKey,
        projectItemId: {
          not: params.projectItemId
        },
        projectItem: {
          projectId: projectItem.projectId
        }
      },
      select: {
        id: true
      }
    });

    if (conflictingMappings.length > 0) {
      await prisma.projectItemEvidence.deleteMany({
        where: {
          id: {
            in: conflictingMappings.map((mapping) => mapping.id)
          }
        }
      });
    }

    return prisma.projectItemEvidence.upsert({
      where: {
        projectItemId_sourceType_sourceRecordKey: {
          projectItemId: params.projectItemId,
          sourceType: params.sourceType,
          sourceRecordKey: params.sourceRecordKey
        }
      },
      update: {
        matchRule: params.matchRule ?? null,
        matchConfidence: params.matchConfidence,
        matchStatus: params.matchStatus,
        isPrimary: params.isPrimary,
        lastSeenAt: params.lastSeenAt ?? new Date(),
        rawLabel: params.rawLabel ?? null,
        ...(rawData !== undefined ? { rawData } : {})
      },
      create: {
        projectItemId: params.projectItemId,
        sourceType: params.sourceType,
        sourceRecordKey: params.sourceRecordKey,
        matchRule: params.matchRule ?? null,
        matchConfidence: params.matchConfidence,
        matchStatus: params.matchStatus,
        isPrimary: params.isPrimary,
        lastSeenAt: params.lastSeenAt ?? new Date(),
        rawLabel: params.rawLabel ?? null,
        ...(rawData !== undefined ? { rawData } : {})
      }
    });
  },

  listByProjectItemId(projectItemId: string) {
    return prisma.projectItemEvidence.findMany({
      where: { projectItemId },
      orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }]
    });
  }
};
