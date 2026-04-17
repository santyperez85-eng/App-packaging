import { ComponentSlot, Prisma } from "@prisma/client";

import {
  booleanOrNull,
  dateOrNull,
  inferComponentSlot,
  inferBusinessUnit,
  numberOrNull,
  slugify,
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

function nestedRawDataOrRow(row: Record<string, unknown>) {
  return row.rawData && typeof row.rawData === "object" && !Array.isArray(row.rawData)
    ? (row.rawData as Record<string, unknown>)
    : row;
}

const MATERIAL_REQUEST_COMPONENT_SLOT_CANDIDATES = [
  "component_slot",
  "componentSlot",
  "slot",
  "component",
  "componente",
  "tipo componente",
  "tipo_componente",
  "componente packaging",
  "componente_packaging",
  "pieza",
  "material_type",
  "tipo material"
];

function getExplicitMaterialRequestComponentSlot(row: Record<string, unknown>) {
  const sourceValue = stringOrNull(getRowValue(row, MATERIAL_REQUEST_COMPONENT_SLOT_CANDIDATES));

  if (!sourceValue) {
    return null;
  }

  const componentSlot = inferComponentSlot(sourceValue);

  if (componentSlot === ComponentSlot.OTRO) {
    return null;
  }

  return {
    sourceValue,
    componentSlot
  };
}

function materialRequestRawData(row: Record<string, unknown>) {
  const explicitComponentSlot = getExplicitMaterialRequestComponentSlot(row);

  return {
    ...row,
    sourceNormalization: {
      ...(explicitComponentSlot
        ? {
            explicitComponentSlot: explicitComponentSlot.componentSlot,
            explicitComponentSlotSourceValue: explicitComponentSlot.sourceValue
          }
        : {})
    }
  };
}

export function mapPmImportRow({
  batchId,
  sourceFileName,
  sheetName,
  row,
  rowNumber
}: MapperContext): Prisma.ImportPmRowCreateManyInput {
  const sourceWorkbook = stringOrNull(getRowValue(row, ["sourceWorkbook", "source_workbook"])) ?? sourceFileName ?? null;
  const businessUnitValue = getRowValue(row, ["business_unit", "unidad negocio", "segmento"]);
  const productName = stringOrNull(getRowValue(row, ["product_name", "producto", "nombre producto"]));
  const presentation = stringOrNull(getRowValue(row, ["presentation", "presentacion"]));
  const activeIngredient = stringOrNull(
    getRowValue(row, ["active_ingredient", "activeIngredient", "droga_activa", "drogaActiva", "droga activa"])
  );
  const projectCode =
    stringOrNull(getRowValue(row, ["project_code", "codigo proyecto", "project id"])) ??
    (sourceWorkbook ? `PM-${slugify(sourceWorkbook.replace(/\.[^.]+$/, "")).toUpperCase()}` : null);
  const inferredProjectName = [productName, presentation].filter(Boolean).join(" - ") || sourceWorkbook;
  const projectName = stringOrNull(getRowValue(row, ["project_name", "nombre proyecto"])) ?? inferredProjectName;

  return {
    batchId,
    sourceFileName,
    sheetName,
    rowNumber,
    projectCode,
    projectName,
    productReference: stringOrNull(getRowValue(row, ["product_code", "product_reference", "codigo producto"])),
    productName,
    presentation,
    activeIngredient,
    templateType: stringOrNull(getRowValue(row, ["template_type", "templateType", "tipo plantilla"])),
    businessUnit: inferBusinessUnit(businessUnitValue),
    macroStatus: stringOrNull(getRowValue(row, ["macro_status", "estado macro", "status"])),
    startDate: dateOrNull(getRowValue(row, ["start_date", "fecha inicio"])),
    targetLaunchDate: dateOrNull(getRowValue(row, ["target_launch_date", "launch_date", "fecha lanzamiento"])),
    rawData: JSON.parse(JSON.stringify(nestedRawDataOrRow(row))) as Prisma.InputJsonObject
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
  const explicitComponentSlot = getExplicitMaterialRequestComponentSlot(row);
  const requestedDescription =
    stringOrNull(
      getRowValue(row, [
        "requested_description",
        "descripcion solicitada",
        "descripcion",
        "description",
        "material_description",
        "descripcion material",
        "detalle",
        "concepto"
      ])
    ) ?? explicitComponentSlot?.sourceValue;

  return {
    batchId,
    sourceFileName,
    sheetName,
    rowNumber,
    projectCode: stringOrNull(
      getRowValue(row, ["project_code", "codigo proyecto", "proyecto", "project id", "case_code", "codigo caso"])
    ),
    requestCode: stringOrNull(
      getRowValue(row, [
        "request_code",
        "pedido codigo",
        "pedido de codigo",
        "solicitud codigo",
        "solicitud de codigo",
        "codigo solicitud",
        "nro solicitud",
        "numero solicitud",
        "numero de solicitud",
        "alta codigo",
        "alta de codigo",
        "nro alta",
        "numero alta",
        "id alta"
      ])
    ),
    requestDate: dateOrNull(
      getRowValue(row, ["request_date", "fecha pedido", "fecha solicitud", "fecha alta", "fecha"])
    ),
    requestedBy: stringOrNull(
      getRowValue(row, ["requested_by", "solicitado por", "solicitante", "responsable", "owner"])
    ),
    materialType: stringOrNull(
      getRowValue(row, ["material_type", "tipo material", "tipo componente", "componente", "component"])
    ),
    requestedDescription: requestedDescription,
    requestStatus: stringOrNull(
      getRowValue(row, ["request_status", "estado pedido", "estado solicitud", "estado alta", "estado", "status"])
    ),
    linkedMaterialCode: stringOrNull(
      getRowValue(row, [
        "linked_material_code",
        "material code",
        "material_code",
        "codigo material",
        "codigo sap material",
        "codigo sap",
        "codigo asignado",
        "codigo creado",
        "nuevo codigo",
        "cod material"
      ])
    ),
    rawData: JSON.parse(JSON.stringify(materialRequestRawData(row))) as Prisma.InputJsonObject
  };
}
