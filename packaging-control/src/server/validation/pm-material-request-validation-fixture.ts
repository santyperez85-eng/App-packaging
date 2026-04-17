import { createBatchId } from "@/lib/utils";

type RawRow = Record<string, unknown>;

type ImportSheet = {
  sheetName: string;
  rows: RawRow[];
};

type ImportPayload = {
  batchId: string;
  sourceFileName?: string;
  sheets: ImportSheet[];
};

const PyloberProjectCode = "PYLOBER";

function buildPyloberPmRawData() {
  return {
    sourceWorkbook: "pylober-pm-fixture.xlsx",
    sheetName: "Producto",
    templateType: "VALIDATION_FIXTURE",
    project_code: PyloberProjectCode,
    project_name: "PYLOBER",
    product_name: "PYLOBER",
    producto: "PYLOBER",
    presentation: "Comprimidos recubiertos",
    presentacion: "Comprimidos recubiertos",
    active_ingredient: "Fixture validation",
    business_unit: "PHARMA",
    packaging_components: "Estuche; Prospecto; Blister; Aluminio",
    rows: [
      ["Producto", "PYLOBER"],
      ["Presentacion", "Comprimidos recubiertos"],
      ["Componentes packaging", "Estuche; Prospecto; Blister; Aluminio"]
    ]
  } satisfies RawRow;
}

export function buildPyloberPmPayload(batchId = createBatchId("validation-pm")): ImportPayload {
  const rawData = buildPyloberPmRawData();

  return {
    batchId,
    sourceFileName: "pylober-pm-fixture.xlsx",
    sheets: [
      {
        sheetName: "Producto",
        rows: [
          {
            ...rawData,
            rawData
          }
        ]
      }
    ]
  };
}

export function buildPyloberMaterialRequestsPayload(
  batchId = createBatchId("validation-altas")
): ImportPayload {
  const validRows: RawRow[] = [
    {
      project_code: PyloberProjectCode,
      request_code: "ALT-PYL-EST",
      request_date: "2026-04-11",
      requested_by: "Gestion de altas",
      component_slot: "ESTUCHE",
      requested_description: "Alta de codigo para estuche PYLOBER",
      request_status: "EN CURSO"
    },
    {
      project_code: PyloberProjectCode,
      request_code: "ALT-PYL-PRO",
      request_date: "2026-04-11",
      requested_by: "Gestion de altas",
      component_slot: "PROSPECTO",
      requested_description: "Alta de codigo para prospecto PYLOBER",
      request_status: "EN CURSO"
    },
    {
      project_code: PyloberProjectCode,
      request_code: "ALT-PYL-BLI",
      request_date: "2026-04-11",
      requested_by: "Gestion de altas",
      component_slot: "BLISTER",
      requested_description: "Alta de codigo para blister PYLOBER",
      request_status: "EN CURSO",
      linked_material_code: "TMP-PYL-BLI"
    },
    {
      project_code: PyloberProjectCode,
      request_code: "ALT-PYL-ALU",
      request_date: "2026-04-11",
      requested_by: "Gestion de altas",
      component_slot: "ALUMINIO",
      requested_description: "Alta de codigo para aluminio PYLOBER",
      request_status: "EN CURSO"
    }
  ];

  const ignoredRows: RawRow[] = [
    {
      project_code: PyloberProjectCode,
      request_code: "ALT-PYL-ETQ-CANCELADA",
      request_date: "2026-04-11",
      requested_by: "Gestion de altas",
      component_slot: "ETIQUETA",
      requested_description: "Alta cancelada para etiqueta PYLOBER",
      request_status: "NO APLICA"
    }
  ];

  return {
    batchId,
    sourceFileName: "pylober-altas-fixture.xlsx",
    sheets: [
      {
        sheetName: "Altas",
        rows: [...validRows, ...ignoredRows]
      }
    ]
  };
}

export const pyloberValidationProjectCode = PyloberProjectCode;
