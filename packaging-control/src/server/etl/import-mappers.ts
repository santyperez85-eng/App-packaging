import { Prisma } from "@prisma/client";

import {
  booleanOrNull,
  dateOrNull,
  inferBusinessUnit,
  numberOrNull,
  stringOrNull
} from "@/lib/utils";
import { getRowValue } from "@/server/etl/excel";

type MapperContext = {
  batchId: string;
  sourceFileName?: string;
  sheetName: string;
  row: Record<string, unknown>;
  rowNumber: number;
};

export function mapPmImportRow({
  batchId,
  sourceFileName,
  sheetName,
  row,
  rowNumber
}: MapperContext): Prisma.ImportPmRowCreateManyInput {
  const projectCode = stringOrNull(getRowValue(row, ["project_code", "codigo proyecto", "project id"]));
  const projectName = stringOrNull(getRowValue(row, ["project_name", "nombre proyecto"]));
  const businessUnitValue = getRowValue(row, ["business_unit", "unidad negocio", "segmento"]);

  return {
    batchId,
    sourceFileName,
    sheetName,
    rowNumber,
    projectCode,
    projectName,
    productReference: stringOrNull(getRowValue(row, ["product_code", "product_reference", "codigo producto"])),
    productName: stringOrNull(getRowValue(row, ["product_name", "producto", "nombre producto"])),
    presentation: stringOrNull(getRowValue(row, ["presentation", "presentacion"])),
    businessUnit: inferBusinessUnit(businessUnitValue),
    macroStatus: stringOrNull(getRowValue(row, ["macro_status", "estado macro", "status"])),
    startDate: dateOrNull(getRowValue(row, ["start_date", "fecha inicio"])),
    targetLaunchDate: dateOrNull(getRowValue(row, ["target_launch_date", "launch_date", "fecha lanzamiento"])),
    rawData: JSON.parse(JSON.stringify(row)) as Prisma.InputJsonObject
  };
}

export function mapMaterialMasterImportRow({
  batchId,
  sourceFileName,
  sheetName,
  row,
  rowNumber
}: MapperContext): Prisma.ImportMaterialMasterRowCreateManyInput {
  return {
    batchId,
    sourceFileName,
    sheetName,
    rowNumber,
    materialCode: stringOrNull(getRowValue(row, ["material_code", "codigo material"])),
    materialType: stringOrNull(getRowValue(row, ["material_type", "tipo material"])),
    description: stringOrNull(getRowValue(row, ["description", "descripcion"])),
    format: stringOrNull(getRowValue(row, ["format", "formato"])),
    measures: stringOrNull(getRowValue(row, ["measures", "medidas"])),
    drawingCode: stringOrNull(getRowValue(row, ["drawing", "drawing_code", "plano"])),
    specificationCode: stringOrNull(getRowValue(row, ["specification", "specification_code", "especificacion"])),
    technicalSheetCode: stringOrNull(getRowValue(row, ["technical_sheet", "technical_sheet_code", "ficha tecnica"])),
    observations: stringOrNull(getRowValue(row, ["observations", "observaciones"])),
    rawData: JSON.parse(JSON.stringify(row)) as Prisma.InputJsonObject
  };
}

export function mapBomImportRow({
  batchId,
  sourceFileName,
  sheetName,
  row,
  rowNumber
}: MapperContext): Prisma.ImportBomRowCreateManyInput {
  return {
    batchId,
    sourceFileName,
    sheetName,
    rowNumber,
    projectCode: stringOrNull(getRowValue(row, ["project_code", "codigo proyecto"])),
    componentKey: stringOrNull(getRowValue(row, ["component_key", "componente", "component code"])),
    componentName: stringOrNull(getRowValue(row, ["component_name", "descripcion componente", "component description"])),
    componentType: stringOrNull(getRowValue(row, ["component_type", "tipo componente"])),
    quantity: numberOrNull(getRowValue(row, ["quantity", "cantidad"])),
    unit: stringOrNull(getRowValue(row, ["unit", "unidad"])),
    isPackaging: booleanOrNull(getRowValue(row, ["is_packaging", "packaging", "es packaging"])),
    expectedMaterialCode: stringOrNull(getRowValue(row, ["expected_material_code", "material_code", "codigo material"])),
    rawData: JSON.parse(JSON.stringify(row)) as Prisma.InputJsonObject
  };
}

export function mapMaterialRequestImportRow({
  batchId,
  sourceFileName,
  sheetName,
  row,
  rowNumber
}: MapperContext): Prisma.ImportMaterialRequestRowCreateManyInput {
  return {
    batchId,
    sourceFileName,
    sheetName,
    rowNumber,
    projectCode: stringOrNull(getRowValue(row, ["project_code", "codigo proyecto"])),
    requestCode: stringOrNull(getRowValue(row, ["request_code", "pedido codigo"])),
    requestDate: dateOrNull(getRowValue(row, ["request_date", "fecha pedido"])),
    requestedBy: stringOrNull(getRowValue(row, ["requested_by", "solicitado por"])),
    materialType: stringOrNull(getRowValue(row, ["material_type", "tipo material"])),
    requestedDescription: stringOrNull(getRowValue(row, ["requested_description", "descripcion solicitada"])),
    requestStatus: stringOrNull(getRowValue(row, ["request_status", "estado pedido"])),
    linkedMaterialCode: stringOrNull(getRowValue(row, ["linked_material_code", "material code", "codigo material"])),
    rawData: JSON.parse(JSON.stringify(row)) as Prisma.InputJsonObject
  };
}
