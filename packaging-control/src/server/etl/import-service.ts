import { importsRepository } from "@/server/repositories/imports-repository";
import {
  mapBomImportRow,
  mapMaterialMasterImportRow,
  mapMaterialRequestImportRow,
  mapPmImportRow
} from "@/server/etl/import-mappers";

type ImportSheet = {
  sheetName: string;
  rows: Record<string, unknown>[];
};

type ImportPayload = {
  batchId: string;
  sourceFileName?: string;
  sheets: ImportSheet[];
};

export const importService = {
  async importPmRows(payload: ImportPayload) {
    const data = payload.sheets.flatMap((sheet) =>
      sheet.rows.map((row, index) =>
        mapPmImportRow({
          batchId: payload.batchId,
          sourceFileName: payload.sourceFileName,
          sheetName: sheet.sheetName,
          row,
          rowNumber: index + 1
        })
      )
    );

    if (data.length) {
      await importsRepository.createPmRows(data);
    }

    return { batchId: payload.batchId, importedRows: data.length };
  },

  async importMaterialMasterRows(payload: ImportPayload) {
    const data = payload.sheets.flatMap((sheet) =>
      sheet.rows.map((row, index) =>
        mapMaterialMasterImportRow({
          batchId: payload.batchId,
          sourceFileName: payload.sourceFileName,
          sheetName: sheet.sheetName,
          row,
          rowNumber: index + 2
        })
      )
    );

    if (data.length) {
      await importsRepository.createMaterialMasterRows(data);
    }

    return { batchId: payload.batchId, importedRows: data.length };
  },

  async importBomRows(payload: ImportPayload) {
    const data = payload.sheets.flatMap((sheet) =>
      sheet.rows.map((row, index) =>
        mapBomImportRow({
          batchId: payload.batchId,
          sourceFileName: payload.sourceFileName,
          sheetName: sheet.sheetName,
          row,
          rowNumber: index + 2
        })
      )
    );

    if (data.length) {
      await importsRepository.createBomRows(data);
    }

    return { batchId: payload.batchId, importedRows: data.length };
  },

  async importMaterialRequestRows(payload: ImportPayload) {
    const data = payload.sheets.flatMap((sheet) =>
      sheet.rows.map((row, index) =>
        mapMaterialRequestImportRow({
          batchId: payload.batchId,
          sourceFileName: payload.sourceFileName,
          sheetName: sheet.sheetName,
          row,
          rowNumber: index + 2
        })
      )
    );

    if (data.length) {
      await importsRepository.createMaterialRequestRows(data);
    }

    return { batchId: payload.batchId, importedRows: data.length };
  }
};
