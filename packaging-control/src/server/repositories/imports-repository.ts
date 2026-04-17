import { ImportProcessStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const importsRepository = {
  createPmRows(data: Prisma.ImportPmRowCreateManyInput[]) {
    return prisma.importPmRow.createMany({ data, skipDuplicates: true });
  },

  createMaterialMasterRows(data: Prisma.ImportMaterialMasterRowCreateManyInput[]) {
    return prisma.importMaterialMasterRow.createMany({ data, skipDuplicates: true });
  },

  createBomRows(data: Prisma.ImportBomRowCreateManyInput[]) {
    return prisma.importBomRow.createMany({ data, skipDuplicates: true });
  },

  createMaterialRequestRows(data: Prisma.ImportMaterialRequestRowCreateManyInput[]) {
    return prisma.importMaterialRequestRow.createMany({ data, skipDuplicates: true });
  },

  getPendingPmRows() {
    return prisma.importPmRow.findMany({
      where: { processingStatus: ImportProcessStatus.PENDING },
      orderBy: [{ createdAt: "asc" }, { rowNumber: "asc" }]
    });
  },

  findLatestPmRowForProject(params: { sourcePmKey?: string | null; projectCode: string }) {
    const candidateProjectCodes = [params.sourcePmKey, params.projectCode].filter(Boolean) as string[];

    return prisma.importPmRow.findFirst({
      where: {
        projectCode: {
          in: candidateProjectCodes
        }
      },
      orderBy: [{ processedAt: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }]
    });
  },

  getPendingMaterialMasterRows() {
    return prisma.importMaterialMasterRow.findMany({
      where: { processingStatus: ImportProcessStatus.PENDING },
      orderBy: [{ createdAt: "asc" }, { rowNumber: "asc" }]
    });
  },

  getPendingBomRows() {
    return prisma.importBomRow.findMany({
      where: { processingStatus: ImportProcessStatus.PENDING },
      orderBy: [{ createdAt: "asc" }, { rowNumber: "asc" }]
    });
  },

  getPendingMaterialRequestRows() {
    return prisma.importMaterialRequestRow.findMany({
      where: { processingStatus: ImportProcessStatus.PENDING },
      orderBy: [{ createdAt: "asc" }, { rowNumber: "asc" }]
    });
  },

  markPmRowProcessed(id: string) {
    return prisma.importPmRow.update({
      where: { id },
      data: {
        processingStatus: ImportProcessStatus.PROCESSED,
        processedAt: new Date(),
        errorMessage: null
      }
    });
  },

  markMaterialMasterRowProcessed(id: string) {
    return prisma.importMaterialMasterRow.update({
      where: { id },
      data: {
        processingStatus: ImportProcessStatus.PROCESSED,
        processedAt: new Date(),
        errorMessage: null
      }
    });
  },

  markBomRowProcessed(id: string) {
    return prisma.importBomRow.update({
      where: { id },
      data: {
        processingStatus: ImportProcessStatus.PROCESSED,
        processedAt: new Date(),
        errorMessage: null
      }
    });
  },

  markMaterialRequestRowProcessed(id: string) {
    return prisma.importMaterialRequestRow.update({
      where: { id },
      data: {
        processingStatus: ImportProcessStatus.PROCESSED,
        processedAt: new Date(),
        errorMessage: null
      }
    });
  },

  markMaterialRequestRowIgnored(id: string, reason: string) {
    return prisma.importMaterialRequestRow.update({
      where: { id },
      data: {
        processingStatus: ImportProcessStatus.PROCESSED,
        processedAt: new Date(),
        errorMessage: `IGNORED: ${reason}`
      }
    });
  },

  markPmRowError(id: string, errorMessage: string) {
    return prisma.importPmRow.update({
      where: { id },
      data: {
        processingStatus: ImportProcessStatus.ERROR,
        errorMessage
      }
    });
  },

  markMaterialMasterRowError(id: string, errorMessage: string) {
    return prisma.importMaterialMasterRow.update({
      where: { id },
      data: {
        processingStatus: ImportProcessStatus.ERROR,
        errorMessage
      }
    });
  },

  markBomRowError(id: string, errorMessage: string) {
    return prisma.importBomRow.update({
      where: { id },
      data: {
        processingStatus: ImportProcessStatus.ERROR,
        errorMessage
      }
    });
  },

  markMaterialRequestRowError(id: string, errorMessage: string) {
    return prisma.importMaterialRequestRow.update({
      where: { id },
      data: {
        processingStatus: ImportProcessStatus.ERROR,
        errorMessage
      }
    });
  }
};
