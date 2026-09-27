import { prisma } from "@/lib/prisma";
import {
  classifyMoonCode,
  createMoondeskClient,
  deriveApprovalState,
  extractClassifiers,
  type MoondeskClient,
  type MoondeskDocumentPayload
} from "@/server/etl/moondesk-api";

/**
 * Sincronizacion con la API de MoonDesk.
 *
 * Trae los documentos y los guarda tal como vienen, sin decidir nada sobre los
 * componentes: igual que el resto de los adaptadores del proyecto, esta capa no
 * crea ni modifica `project_items`. Quien cruza documentos con componentes es el
 * checklist de cierre.
 *
 * La sincronizacion completa son ~150 pedidos (20 documentos por pagina). Con
 * `since` se pide solo lo que cambio desde una fecha, que es lo que conviene
 * para las corridas del dia a dia.
 */

function toDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export type MoondeskSyncResult = {
  documentCount: number;
  approvedCurrent: number;
  approvedOutdated: number;
  neverApproved: number;
  /** Codigos MOON mal tipeados: rompen el cruce con DOCUMENTOS APROBADOS. */
  malformedCodes: string[];
  /** Codigos del sistema viejo (PL366, EM285): validos, no son errores. */
  legacyCodeCount: number;
  documentsWithoutMaterialCode: number;
  incremental: boolean;
  syncId: string;
};

export const moondeskApiService = {
  /** Prueba de conexion: devuelve el workspace al que apunta la clave. */
  async checkConnection(client?: MoondeskClient) {
    const api = client ?? createMoondeskClient();
    const configuration = await api.getConfiguration();

    return {
      baseUrl: api.baseUrl,
      documentTypes: configuration.documentTypes.map((type) => type.name),
      classes: configuration.classes.map((entry) => ({
        name: entry.name,
        valueCount: entry.classValues?.length ?? 0
      }))
    };
  },

  async sync(options?: {
    client?: MoondeskClient;
    /** Solo documentos modificados desde esta fecha. */
    since?: Date;
    onProgress?: (page: number, pageCount: number, total: number) => void;
  }): Promise<MoondeskSyncResult> {
    const api = options?.client ?? createMoondeskClient();
    const incremental = Boolean(options?.since);
    const sync = await prisma.moondeskApiSync.create({ data: { incremental } });

    try {
      const counts = { approvedCurrent: 0, approvedOutdated: 0, neverApproved: 0 };
      const malformedCodes = new Set<string>();
      let legacyCodeCount = 0;
      let documentsWithoutMaterialCode = 0;
      let documentCount = 0;

      // Se guarda pagina por pagina: la corrida completa pasa los veinte
      // minutos y no tiene sentido perder todo si falla cerca del final.
      for await (const batch of api.streamDocuments(
        options?.since ? { minUpdateDate: options.since.toISOString() } : {}
      )) {
        for (const document of batch.documents) {
          const classifiers = extractClassifiers(document);
          const approvalState = deriveApprovalState(document);

          if (approvalState === "approved_current") counts.approvedCurrent += 1;
          else if (approvalState === "approved_outdated") counts.approvedOutdated += 1;
          else counts.neverApproved += 1;

          if (!classifiers.materialCode) {
            documentsWithoutMaterialCode += 1;
          }

          for (const code of [
            classifiers.drawingCode,
            classifiers.specificationCode,
            classifiers.technicalSheetCode
          ]) {
            const kind = classifyMoonCode(code);
            if (kind === "malformed" && code) malformedCodes.add(code.trim());
            if (kind === "legacy") legacyCodeCount += 1;
          }

          await this.persistDocument(document, classifiers, approvalState);
          documentCount += 1;
        }

        await prisma.moondeskApiSync.update({
          where: { id: sync.id },
          data: { documentCount }
        });
        options?.onProgress?.(batch.page, batch.pageCount, batch.total);
      }

      const result: MoondeskSyncResult = {
        documentCount,
        ...counts,
        malformedCodes: [...malformedCodes].sort(),
        legacyCodeCount,
        documentsWithoutMaterialCode,
        incremental,
        syncId: sync.id
      };

      await prisma.moondeskApiSync.update({
        where: { id: sync.id },
        data: {
          finishedAt: new Date(),
          documentCount: result.documentCount,
          approvedCurrent: result.approvedCurrent,
          approvedOutdated: result.approvedOutdated,
          neverApproved: result.neverApproved,
          malformedCodes: result.malformedCodes
        }
      });

      return result;
    } catch (error) {
      await prisma.moondeskApiSync.update({
        where: { id: sync.id },
        data: { finishedAt: new Date(), error: error instanceof Error ? error.message : String(error) }
      });
      throw error;
    }
  },

  async persistDocument(
    document: MoondeskDocumentPayload,
    classifiers: ReturnType<typeof extractClassifiers>,
    approvalState: string
  ) {
    const approved = document.lastApprovedVersion;
    const latest = document.lastVersion;

    const data = {
      documentId: document.documentId,
      documentType: document.documentType,
      materialCode: classifiers.materialCode,
      productName: classifiers.productName,
      presentation: classifiers.presentation,
      concentration: classifiers.concentration,
      format: classifiers.format,
      destination: classifiers.destination,
      drawingCode: classifiers.drawingCode,
      specificationCode: classifiers.specificationCode,
      technicalSheetCode: classifiers.technicalSheetCode,
      description: classifiers.description,
      materialTypeLabel: classifiers.materialTypeLabel,
      latestVersionNumber: document.latestMayorVersionNumber,
      latestMinorVersionNumber: document.latestMinorVersionNumber,
      approvedVersionNumber: document.latestApprovedVersionNumber,
      approvalState,
      approvedAt: toDate(approved?.approvedTimestampUtc),
      approvedBy: approved?.approvedBy ?? null,
      lastVersionAt: toDate(latest?.timestampUtc),
      lastVersionStatus: latest?.status ?? null,
      hasPendingTasks: Boolean(document.hasPendingTasks),
      pendingTaskCount: document.pendingTasks?.length ?? 0,
      classValues: (document.classValues ?? []) as never,
      syncedAt: new Date()
    };

    return prisma.moondeskApiDocument.upsert({
      where: { documentNumber: document.documentNumber },
      update: data,
      create: { documentNumber: document.documentNumber, ...data }
    });
  },

  /**
   * Documentos publicados en MoonDesk para los codigos de material dados.
   *
   * Un mismo codigo puede tener varios documentos (tipicamente uno de Venta y
   * otro Digital), asi que devuelve una lista por codigo y no un unico registro.
   */
  async getByMaterialCodes(materialCodes: string[]) {
    const codes = [...new Set(materialCodes.filter(Boolean).map((code) => code.trim()))];

    if (!codes.length) {
      return new Map<string, MoondeskDocumentSummary[]>();
    }

    const documents = await prisma.moondeskApiDocument.findMany({
      where: { materialCode: { in: codes } },
      orderBy: [{ documentNumber: "asc" }]
    });

    const byCode = new Map<string, MoondeskDocumentSummary[]>();

    for (const document of documents) {
      if (!document.materialCode) continue;

      const key = document.materialCode.trim().toUpperCase();
      const list = byCode.get(key) ?? [];
      list.push({
        documentNumber: document.documentNumber,
        documentType: document.documentType,
        destination: document.destination,
        approvalState: document.approvalState,
        approvedVersionNumber: document.approvedVersionNumber,
        latestVersionNumber: document.latestVersionNumber,
        approvedAt: document.approvedAt,
        drawingCode: document.drawingCode,
        specificationCode: document.specificationCode,
        technicalSheetCode: document.technicalSheetCode
      });
      byCode.set(key, list);
    }

    return byCode;
  },

  /** Ultima sincronizacion terminada, para mostrar la antiguedad del dato. */
  async getLastSync() {
    return prisma.moondeskApiSync.findFirst({
      where: { finishedAt: { not: null }, error: null },
      orderBy: [{ finishedAt: "desc" }]
    });
  },

  /** Lo que el tablero necesita saber de la ultima sincronizacion. */
  async getFreshness() {
    const sync = await this.getLastSync();

    if (!sync?.finishedAt) {
      return null;
    }

    const ageInDays = Math.max(
      0,
      Math.floor((Date.now() - sync.finishedAt.getTime()) / (24 * 60 * 60 * 1000))
    );

    return {
      finishedAt: sync.finishedAt.toISOString(),
      documentCount: sync.documentCount,
      approvedCurrent: sync.approvedCurrent,
      approvedOutdated: sync.approvedOutdated,
      neverApproved: sync.neverApproved,
      ageInDays,
      // A diferencia de SAP, sincronizar no depende de nadie: se puede correr
      // cuando se quiera, asi que una semana ya es mucho.
      stale: ageInDays > 7
    };
  }
};

export type MoondeskDocumentSummary = {
  documentNumber: number;
  documentType: string | null;
  destination: string | null;
  approvalState: string;
  approvedVersionNumber: number | null;
  latestVersionNumber: number | null;
  approvedAt: Date | null;
  drawingCode: string | null;
  specificationCode: string | null;
  technicalSheetCode: string | null;
};
