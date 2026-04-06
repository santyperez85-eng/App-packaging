import {
  AlertStatus,
  ApplicabilityStatus,
  BusinessUnit,
  CheckStatus,
  CheckType,
  ComponentSlot,
  ItemCriticality,
  ItemType,
  MatchingStatus,
  MaterialRequestStatus,
  MaterialType,
  MoondeskTaskStatus,
  MoondeskTaskType,
  ProjectItemExpectedStatus,
  ProjectItemIdentificationStatus,
  ProjectItemOriginMode,
  ProjectStatus,
  ScopeDefinedStatus
} from "@prisma/client";

import type { ProjectItemRulesRecord } from "@/server/rules/project-item-rules";
import type { ProjectHealthRecord } from "@/server/rules/project-rules";

export type FunctionalScenarioItemExpectation = {
  itemKey: string;
  originMode: ProjectItemOriginMode;
  expectedStatus: ProjectItemExpectedStatus;
  matchingStatus: MatchingStatus;
  expectedItemStatus: string;
  readinessRange: [number, number];
  requiredAlerts: string[];
};

export type FunctionalScenario = {
  id: string;
  title: string;
  summary: string;
  project: ProjectHealthRecord;
  itemExpectations: FunctionalScenarioItemExpectation[];
  projectExpectation: {
    healthRange: [number, number];
    canClose: boolean;
  };
};

type BuildProjectParams = {
  id: string;
  code: string;
  name: string;
  scopeDefined?: ScopeDefinedStatus;
  healthScore?: number;
};

type BuildItemParams = {
  id: string;
  project: ReturnType<typeof buildProjectBase>;
  itemKey: string;
  name: string;
  componentSlot: ComponentSlot;
  originMode: ProjectItemOriginMode;
  expectedStatus: ProjectItemExpectedStatus;
  matchingStatus?: MatchingStatus;
  applicabilityStatus?: ApplicabilityStatus;
  criticality?: ItemCriticality;
  expectedMaterialCode?: string | null;
  provisionalCode?: string | null;
  bom?: {
    componentKey: string;
    componentName: string;
    expectedMaterialCode?: string | null;
    notes?: string | null;
  } | null;
  request?: {
    requestCode?: string | null;
    requestedDescription: string;
    linkedMaterialCode?: string | null;
    requestStatus?: MaterialRequestStatus;
  } | null;
  material?: {
    materialCode: string;
    description: string;
    drawingCode?: string | null;
    specificationCode?: string | null;
    technicalSheetCode?: string | null;
    sap?: {
      materialCode: string;
      description?: string | null;
      purchaseStatus?: string | null;
      activeFlag?: boolean;
    } | null;
  } | null;
  moondesk?: {
    designCompleted?: boolean;
    reviewInProgress?: boolean;
    reviewDueDate?: Date | null;
    approvedDocument?: boolean;
  } | null;
  technicalChecks?: Array<{
    checkType: CheckType;
    status: CheckStatus;
    isBlocking?: boolean;
  }>;
  evidences?: Array<{
    sourceType: string;
    sourceRecordKey: string;
    rawLabel?: string;
  }>;
};

function buildProjectBase(params: BuildProjectParams) {
  return {
    id: params.id,
    code: params.code,
    name: params.name,
    caseType: "validation_case",
    changeDriver: "validation",
    presentation: "demo",
    activeIngredient: null,
    sapFinishedCode: `PT-${params.code}`,
    scopeDefined: params.scopeDefined ?? ScopeDefinedStatus.DEFINED,
    description: null,
    businessUnit: BusinessUnit.PHARMA,
    status: ProjectStatus.ACTIVE,
    macroStatus: "Validacion funcional",
    healthScore: params.healthScore ?? 0,
    sourcePmKey: params.code,
    startDate: new Date("2026-04-01"),
    targetLaunchDate: new Date("2026-06-30"),
    closedAt: null,
    createdAt: new Date("2026-04-01"),
    updatedAt: new Date("2026-04-01"),
    productId: null,
    ownerId: null,
    product: null,
    owner: null,
    projectItems: [],
    bomItems: [],
    materialRequests: [],
    alerts: []
  };
}

function buildItem(params: BuildItemParams): ProjectItemRulesRecord {
  const bomItem = params.bom
    ? {
        id: `bom-${params.id}`,
        projectId: params.project.id,
        componentKey: params.bom.componentKey,
        componentName: params.bom.componentName,
        componentType: ItemType.OTHER,
        quantity: 1,
        unit: "EA",
        isPackaging: true,
        isCritical: params.criticality === ItemCriticality.CRITICAL,
        expectedMaterialCode: params.bom.expectedMaterialCode ?? null,
        notes: params.bom.notes ?? null,
        createdAt: new Date("2026-04-01"),
        updatedAt: new Date("2026-04-01"),
        project: params.project,
        projectItems: []
      }
    : null;

  const materialRequest = params.request
    ? {
        id: `req-${params.id}`,
        projectId: params.project.id,
        requestedById: null,
        requestCode: params.request.requestCode ?? null,
        requestDate: new Date("2026-04-02"),
        requestedByName: "Validation PM",
        materialType: MaterialType.OTHER,
        requestedDescription: params.request.requestedDescription,
        requestStatus: params.request.requestStatus ?? MaterialRequestStatus.IN_PROGRESS,
        linkedMaterialCode: params.request.linkedMaterialCode ?? null,
        linkedMaterialId: null,
        sourceExternalId: `ext-${params.id}`,
        notes: null,
        createdAt: new Date("2026-04-02"),
        updatedAt: new Date("2026-04-02"),
        project: params.project,
        requester: null,
        linkedMaterial: null,
        projectItems: []
      }
    : null;

  const materialMaster = params.material
    ? {
        id: `mat-${params.id}`,
        materialCode: params.material.materialCode,
        rootCode: null,
        versionLabel: null,
        materialType: MaterialType.OTHER,
        description: params.material.description,
        format: null,
        measures: null,
        supplier: null,
        drawingCode: params.material.drawingCode ?? null,
        specificationCode: params.material.specificationCode ?? null,
        technicalSheetCode: params.material.technicalSheetCode ?? null,
        observations: null,
        changeHistoryText: null,
        activeFlag: true,
        createdAt: new Date("2026-04-03"),
        updatedAt: new Date("2026-04-03"),
        projectItems: [],
        linkedRequests: [],
        sapMaterial: params.material.sap
          ? {
              id: `sap-${params.id}`,
              materialCode: params.material.sap.materialCode,
              materialMasterId: `mat-${params.id}`,
              description: params.material.sap.description ?? null,
              activeFlag: params.material.sap.activeFlag ?? true,
              supplier: null,
              purchaseStatus: params.material.sap.purchaseStatus ?? null,
              sourceUpdatedAt: new Date("2026-04-03"),
              createdAt: new Date("2026-04-03"),
              updatedAt: new Date("2026-04-03"),
              materialMaster: null,
              rawImports: []
            }
          : null,
        changeHistoryEntries: [],
        pos652Evaluations: []
      }
    : null;

  const moondeskTasks = [
    params.moondesk?.designCompleted
      ? {
          id: `md-design-${params.id}`,
          externalTaskId: `md-design-${params.id}`,
          projectItemId: params.id,
          taskType: MoondeskTaskType.DESIGN_REQUEST,
          taskStatus: MoondeskTaskStatus.COMPLETED,
          title: `Diseno ${params.name}`,
          dueDate: new Date("2026-04-03"),
          assignedDesigner: "Validation Designer",
          versionsCount: 1,
          latestVersionLabel: "v1",
          reviewDecision: null,
          approvedVersionAvailable: Boolean(params.moondesk?.approvedDocument),
          comments: null,
          sourceUpdatedAt: new Date("2026-04-03"),
          createdAt: new Date("2026-04-03"),
          updatedAt: new Date("2026-04-03"),
          projectItem: null,
          versions: [],
          reviews: [],
          documents: params.moondesk?.approvedDocument
            ? [
                {
                  id: `md-doc-${params.id}`,
                  moondeskTaskId: `md-design-${params.id}`,
                  documentType: "APPROVED_PDF",
                  name: `Approved ${params.name}`,
                  url: null,
                  externalDocumentId: null,
                  approved: true,
                  versionLabel: "v1",
                  createdAt: new Date("2026-04-03"),
                  updatedAt: new Date("2026-04-03"),
                  moondeskTask: null
                }
              ]
            : []
        }
      : null,
    params.moondesk?.reviewInProgress
      ? {
          id: `md-review-${params.id}`,
          externalTaskId: `md-review-${params.id}`,
          projectItemId: params.id,
          taskType: MoondeskTaskType.REVIEW_REQUEST,
          taskStatus: MoondeskTaskStatus.IN_PROGRESS,
          title: `Revision ${params.name}`,
          dueDate: params.moondesk.reviewDueDate ?? new Date("2026-04-20"),
          assignedDesigner: "Validation Reviewer",
          versionsCount: 1,
          latestVersionLabel: "v1",
          reviewDecision: null,
          approvedVersionAvailable: Boolean(params.moondesk?.approvedDocument),
          comments: null,
          sourceUpdatedAt: new Date("2026-04-04"),
          createdAt: new Date("2026-04-04"),
          updatedAt: new Date("2026-04-04"),
          projectItem: null,
          versions: [],
          reviews: [],
          documents: []
        }
      : null
  ].filter(Boolean);

  const evidences = (params.evidences ?? []).map((evidence, index) => ({
    id: `evidence-${params.id}-${index}`,
    projectItemId: params.id,
    sourceType: evidence.sourceType,
    sourceRecordKey: evidence.sourceRecordKey,
    matchRule: evidence.sourceType,
    matchConfidence: "HIGH",
    matchStatus: params.matchingStatus ?? MatchingStatus.EXACT,
    isPrimary: index === 0,
    lastSeenAt: new Date("2026-04-04"),
    rawLabel: evidence.rawLabel ?? params.name,
    createdAt: new Date("2026-04-04"),
    updatedAt: new Date("2026-04-04"),
    projectItem: null
  }));

  const technicalChecks = (params.technicalChecks ?? []).map((check, index) => ({
    id: `check-${params.id}-${index}`,
    projectItemId: params.id,
    checkedById: null,
    checkType: check.checkType,
    status: check.status,
    isBlocking: check.isBlocking ?? true,
    notes: null,
    checkedAt: null,
    createdAt: new Date("2026-04-04"),
    updatedAt: new Date("2026-04-04"),
    projectItem: null,
    checkedBy: null
  }));

  return {
    id: params.id,
    projectId: params.project.id,
    bomItemId: bomItem?.id ?? null,
    materialRequestId: materialRequest?.id ?? null,
    materialMasterId: materialMaster?.id ?? null,
    itemKey: params.itemKey,
    name: params.name,
    description: null,
    componentSlot: params.componentSlot,
    applicabilityStatus: params.applicabilityStatus ?? ApplicabilityStatus.APPLIES,
    originMode: params.originMode,
    provisional: !materialMaster,
    expectedStatus: params.expectedStatus,
    identificationStatus: materialMaster
      ? ProjectItemIdentificationStatus.IDENTIFIED
      : params.request?.requestCode || params.provisionalCode || params.expectedMaterialCode
        ? ProjectItemIdentificationStatus.PARTIALLY_IDENTIFIED
        : ProjectItemIdentificationStatus.NOT_IDENTIFIED,
    matchingStatus: params.matchingStatus ?? MatchingStatus.EXACT,
    provisionalCode: params.provisionalCode ?? params.request?.requestCode ?? null,
    itemType: params.componentSlot === ComponentSlot.ESTUCHE ? ItemType.BOX : ItemType.OTHER,
    criticality: params.criticality ?? ItemCriticality.HIGH,
    status: "PENDING",
    readinessScore: 0,
    isPackaging: true,
    requiresMaterialCode: true,
    requiresApprovedDocument: true,
    requiresTechnicalDocs: true,
    expectedMaterialCode: params.expectedMaterialCode ?? params.bom?.expectedMaterialCode ?? null,
    versioningRecommendation: "NO_SIGNAL",
    createdAt: new Date("2026-04-01"),
    updatedAt: new Date("2026-04-05"),
    project: params.project,
    bomItem,
    materialRequest,
    materialMaster,
    moondeskTasks: moondeskTasks as never[],
    evidences: evidences as never[],
    technicalChecks: technicalChecks as never[],
    alerts: [],
    approvals: [],
    issues: []
  } as unknown as ProjectItemRulesRecord;
}

function buildScenarioProject(projectBase: ReturnType<typeof buildProjectBase>, items: ProjectItemRulesRecord[]): ProjectHealthRecord {
  return {
    ...projectBase,
    projectItems: items,
    alerts: [],
    bomItems: [],
    materialRequests: []
  } as unknown as ProjectHealthRecord;
}

const scenario1Project = buildProjectBase({
  id: "scenario-01-project",
  code: "VAL-001",
  name: "Expected Component Without Evidence"
});

const scenario2Project = buildProjectBase({
  id: "scenario-02-project",
  code: "VAL-002",
  name: "Evidence Without PM"
});

const scenario3Project = buildProjectBase({
  id: "scenario-03-project",
  code: "VAL-003",
  name: "Expectation Reconciled With Evidence"
});

const scenario4Project = buildProjectBase({
  id: "scenario-04-project",
  code: "VAL-004",
  name: "Ambiguous Match"
});

const scenario5Project = buildProjectBase({
  id: "scenario-05-project",
  code: "VAL-005",
  name: "Code Not Requested"
});

const scenario6Project = buildProjectBase({
  id: "scenario-06-project",
  code: "VAL-006",
  name: "Missing Internal Technical Docs"
});

const scenario7Project = buildProjectBase({
  id: "scenario-07-project",
  code: "VAL-007",
  name: "Approved Doc Without Formalization"
});

const scenario8Project = buildProjectBase({
  id: "scenario-08-project",
  code: "VAL-008",
  name: "Almost Complete Case"
});

const scenario1Items = [
  buildItem({
    id: "scenario-01-item",
    project: scenario1Project,
    itemKey: "PM-ETIQUETA",
    name: "Etiqueta principal",
    componentSlot: ComponentSlot.ETIQUETA,
    originMode: ProjectItemOriginMode.PM_EXPECTED,
    expectedStatus: ProjectItemExpectedStatus.EXPECTED,
    matchingStatus: MatchingStatus.INFERRED,
    evidences: [{ sourceType: "pm_expected", sourceRecordKey: "ETIQUETA" }]
  })
];

const scenario2Items = [
  buildItem({
    id: "scenario-02-item",
    project: scenario2Project,
    itemKey: "REQ-BLISTER",
    name: "Blister 10 comprimidos",
    componentSlot: ComponentSlot.BLISTER,
    originMode: ProjectItemOriginMode.REQUEST_DETECTED,
    expectedStatus: ProjectItemExpectedStatus.EVIDENCED,
    matchingStatus: MatchingStatus.INFERRED,
    provisionalCode: "REQ-VAL-020",
    request: {
      requestCode: "REQ-VAL-020",
      requestedDescription: "Blister 10 comprimidos"
    },
    evidences: [{ sourceType: "material_request", sourceRecordKey: "REQ-VAL-020" }]
  })
];

const scenario3Items = [
  buildItem({
    id: "scenario-03-item",
    project: scenario3Project,
    itemKey: "PM-ESTUCHE",
    name: "Estuche 60 ml",
    componentSlot: ComponentSlot.ESTUCHE,
    originMode: ProjectItemOriginMode.PM_EXPECTED,
    expectedStatus: ProjectItemExpectedStatus.EXPECTED,
    matchingStatus: MatchingStatus.EXACT,
    bom: {
      componentKey: "ESTUCHE-60",
      componentName: "Estuche 60 ml",
      expectedMaterialCode: "MAT-VAL-EST-060"
    },
    request: {
      requestCode: "REQ-VAL-031",
      requestedDescription: "Estuche 60 ml",
      linkedMaterialCode: "MAT-VAL-EST-060",
      requestStatus: MaterialRequestStatus.COMPLETED
    },
    material: {
      materialCode: "MAT-VAL-EST-060",
      description: "Estuche 60 ml",
      drawingCode: "DRW-060",
      specificationCode: "SPEC-060",
      technicalSheetCode: "TS-060",
      sap: {
        materialCode: "MAT-VAL-EST-060",
        description: "Estuche 60 ml",
        purchaseStatus: "fase 1",
        activeFlag: true
      }
    },
    moondesk: {
      designCompleted: true,
      approvedDocument: true
    },
    evidences: [
      { sourceType: "pm_expected", sourceRecordKey: "ESTUCHE" },
      { sourceType: "bom", sourceRecordKey: "ESTUCHE-60" },
      { sourceType: "material_request", sourceRecordKey: "REQ-VAL-031" },
      { sourceType: "materials_master", sourceRecordKey: "MAT-VAL-EST-060" }
    ]
  })
];

const scenario4Items = [
  buildItem({
    id: "scenario-04-item",
    project: scenario4Project,
    itemKey: "PM-PROSPECTO",
    name: "Prospecto adulto",
    componentSlot: ComponentSlot.PROSPECTO,
    originMode: ProjectItemOriginMode.PM_EXPECTED,
    expectedStatus: ProjectItemExpectedStatus.EXPECTED,
    matchingStatus: MatchingStatus.AMBIGUOUS,
    expectedMaterialCode: "MAT-A",
    bom: {
      componentKey: "PROSPECTO-A",
      componentName: "Prospecto adulto",
      expectedMaterialCode: "MAT-B"
    },
    evidences: [
      { sourceType: "pm_expected", sourceRecordKey: "PROSPECTO" },
      { sourceType: "bom", sourceRecordKey: "PROSPECTO-A" }
    ]
  })
];

const scenario5Items = [
  buildItem({
    id: "scenario-05-item",
    project: scenario5Project,
    itemKey: "PM-FRASCO",
    name: "Frasco 100 ml",
    componentSlot: ComponentSlot.FRASCO,
    originMode: ProjectItemOriginMode.PM_EXPECTED,
    expectedStatus: ProjectItemExpectedStatus.EXPECTED,
    matchingStatus: MatchingStatus.INFERRED,
    bom: {
      componentKey: "FRASCO-100",
      componentName: "Frasco 100 ml"
    },
    evidences: [
      { sourceType: "pm_expected", sourceRecordKey: "FRASCO" },
      { sourceType: "bom", sourceRecordKey: "FRASCO-100" }
    ]
  })
];

const scenario6Items = [
  buildItem({
    id: "scenario-06-item",
    project: scenario6Project,
    itemKey: "ETIQUETA-VALIDACION",
    name: "Etiqueta frontal",
    componentSlot: ComponentSlot.ETIQUETA,
    originMode: ProjectItemOriginMode.BOM_DETECTED,
    expectedStatus: ProjectItemExpectedStatus.EVIDENCED,
    matchingStatus: MatchingStatus.EXACT,
    bom: {
      componentKey: "ETIQUETA-FRONTAL",
      componentName: "Etiqueta frontal"
    },
    material: {
      materialCode: "MAT-VAL-ETQ-001",
      description: "Etiqueta frontal",
      drawingCode: "DRW-ETQ-001",
      specificationCode: null,
      technicalSheetCode: null
    },
    evidences: [
      { sourceType: "bom", sourceRecordKey: "ETIQUETA-FRONTAL" },
      { sourceType: "materials_master", sourceRecordKey: "MAT-VAL-ETQ-001" }
    ]
  })
];

const scenario7Items = [
  buildItem({
    id: "scenario-07-item",
    project: scenario7Project,
    itemKey: "INSERT-VAL",
    name: "Inserto promocional",
    componentSlot: ComponentSlot.INSERTO,
    originMode: ProjectItemOriginMode.REQUEST_DETECTED,
    expectedStatus: ProjectItemExpectedStatus.EVIDENCED,
    matchingStatus: MatchingStatus.INFERRED,
    bom: {
      componentKey: "INSERTO-VAL",
      componentName: "Inserto promocional"
    },
    request: {
      requestCode: "REQ-VAL-070",
      requestedDescription: "Inserto promocional"
    },
    moondesk: {
      designCompleted: true,
      approvedDocument: true
    },
    evidences: [
      { sourceType: "bom", sourceRecordKey: "INSERTO-VAL" },
      { sourceType: "material_request", sourceRecordKey: "REQ-VAL-070" }
    ]
  })
];

const scenario8Items = [
  buildItem({
    id: "scenario-08-item-ready",
    project: scenario8Project,
    itemKey: "ESTUCHE-READY",
    name: "Estuche final",
    componentSlot: ComponentSlot.ESTUCHE,
    originMode: ProjectItemOriginMode.PM_EXPECTED,
    expectedStatus: ProjectItemExpectedStatus.EXPECTED,
    matchingStatus: MatchingStatus.EXACT,
    bom: {
      componentKey: "ESTUCHE-READY",
      componentName: "Estuche final",
      expectedMaterialCode: "MAT-EST-READY"
    },
    request: {
      requestCode: "REQ-VAL-081",
      requestedDescription: "Estuche final",
      linkedMaterialCode: "MAT-EST-READY",
      requestStatus: MaterialRequestStatus.COMPLETED
    },
    material: {
      materialCode: "MAT-EST-READY",
      description: "Estuche final",
      drawingCode: "DRW-EST-READY",
      specificationCode: "SPEC-EST-READY",
      technicalSheetCode: "TS-EST-READY",
      sap: {
        materialCode: "MAT-EST-READY",
        description: "Estuche final",
        purchaseStatus: "fase 1",
        activeFlag: true
      }
    },
    moondesk: {
      designCompleted: true,
      approvedDocument: true
    },
    evidences: [
      { sourceType: "pm_expected", sourceRecordKey: "ESTUCHE" },
      { sourceType: "bom", sourceRecordKey: "ESTUCHE-READY" },
      { sourceType: "material_request", sourceRecordKey: "REQ-VAL-081" },
      { sourceType: "materials_master", sourceRecordKey: "MAT-EST-READY" }
    ]
  }),
  buildItem({
    id: "scenario-08-item-review",
    project: scenario8Project,
    itemKey: "ETIQUETA-REVIEW",
    name: "Etiqueta final",
    componentSlot: ComponentSlot.ETIQUETA,
    originMode: ProjectItemOriginMode.PM_EXPECTED,
    expectedStatus: ProjectItemExpectedStatus.EXPECTED,
    matchingStatus: MatchingStatus.EXACT,
    criticality: ItemCriticality.CRITICAL,
    bom: {
      componentKey: "ETIQUETA-REVIEW",
      componentName: "Etiqueta final",
      expectedMaterialCode: "MAT-ETQ-READY"
    },
    request: {
      requestCode: "REQ-VAL-082",
      requestedDescription: "Etiqueta final",
      linkedMaterialCode: "MAT-ETQ-READY",
      requestStatus: MaterialRequestStatus.COMPLETED
    },
    material: {
      materialCode: "MAT-ETQ-READY",
      description: "Etiqueta final",
      drawingCode: "DRW-ETQ-READY",
      specificationCode: "SPEC-ETQ-READY",
      technicalSheetCode: "TS-ETQ-READY",
      sap: {
        materialCode: "MAT-ETQ-READY",
        description: "Etiqueta final",
        purchaseStatus: "fase 1",
        activeFlag: true
      }
    },
    moondesk: {
      designCompleted: true,
      reviewInProgress: true,
      reviewDueDate: new Date("2026-04-20"),
      approvedDocument: false
    },
    evidences: [
      { sourceType: "pm_expected", sourceRecordKey: "ETIQUETA" },
      { sourceType: "bom", sourceRecordKey: "ETIQUETA-REVIEW" },
      { sourceType: "material_request", sourceRecordKey: "REQ-VAL-082" },
      { sourceType: "materials_master", sourceRecordKey: "MAT-ETQ-READY" }
    ]
  })
];

export const functionalValidationScenarios: FunctionalScenario[] = [
  {
    id: "expected-component-without-evidence",
    title: "Componente esperado sin evidencia",
    summary: "PM define el componente, pero todavia no existe BOM, pedido de codigo, material ni circuito documental.",
    project: buildScenarioProject(scenario1Project, scenario1Items),
    itemExpectations: [
      {
        itemKey: "PM-ETIQUETA",
        originMode: ProjectItemOriginMode.PM_EXPECTED,
        expectedStatus: ProjectItemExpectedStatus.EXPECTED,
        matchingStatus: MatchingStatus.INFERRED,
        expectedItemStatus: "WAITING_CODE",
        readinessRange: [5, 20],
        requiredAlerts: [
          "EXPECTED_COMPONENT_MISSING",
          "CODE_NOT_REQUESTED",
          "PRE_BOM_MISSING",
          "APPROVED_DOCUMENT_MISSING"
        ]
      }
    ],
    projectExpectation: {
      healthRange: [15, 35],
      canClose: false
    }
  },
  {
    id: "evidence-without-pm",
    title: "Evidencia sin PM suficiente",
    summary: "No hay expectativa PM clara, pero existe pedido de codigo y el sistema debe tolerar el nacimiento por evidencia secundaria.",
    project: buildScenarioProject(scenario2Project, scenario2Items),
    itemExpectations: [
      {
        itemKey: "REQ-BLISTER",
        originMode: ProjectItemOriginMode.REQUEST_DETECTED,
        expectedStatus: ProjectItemExpectedStatus.EVIDENCED,
        matchingStatus: MatchingStatus.INFERRED,
        expectedItemStatus: "WAITING_CODE",
        readinessRange: [25, 40],
        requiredAlerts: [
          "PRE_BOM_MISSING",
          "REQUEST_WITHOUT_FORMAL_MATERIAL",
          "APPROVED_DOCUMENT_MISSING"
        ]
      }
    ],
    projectExpectation: {
      healthRange: [35, 50],
      canClose: false
    }
  },
  {
    id: "expectation-reconciled-with-evidence",
    title: "Reconciliacion correcta entre expectativa y evidencia",
    summary: "PM, BOM, pedido de codigo, maestro interno, formalizacion y documento aprobado convergen sobre el mismo item.",
    project: buildScenarioProject(scenario3Project, scenario3Items),
    itemExpectations: [
      {
        itemKey: "PM-ESTUCHE",
        originMode: ProjectItemOriginMode.PM_EXPECTED,
        expectedStatus: ProjectItemExpectedStatus.EXPECTED,
        matchingStatus: MatchingStatus.EXACT,
        expectedItemStatus: "READY",
        readinessRange: [95, 100],
        requiredAlerts: []
      }
    ],
    projectExpectation: {
      healthRange: [95, 100],
      canClose: true
    }
  },
  {
    id: "ambiguous-match",
    title: "Match ambiguo",
    summary: "La definicion reconciliada es ambigua y ademas hay senales de codigo conflictivas entre fuentes.",
    project: buildScenarioProject(scenario4Project, scenario4Items),
    itemExpectations: [
      {
        itemKey: "PM-PROSPECTO",
        originMode: ProjectItemOriginMode.PM_EXPECTED,
        expectedStatus: ProjectItemExpectedStatus.EXPECTED,
        matchingStatus: MatchingStatus.AMBIGUOUS,
        expectedItemStatus: "BLOCKED",
        readinessRange: [0, 20],
        requiredAlerts: [
          "DEFINITION_AMBIGUOUS",
          "CROSS_SOURCE_INCONSISTENCY",
          "CODE_NOT_REQUESTED"
        ]
      }
    ],
    projectExpectation: {
      healthRange: [35, 50],
      canClose: false
    }
  },
  {
    id: "code-not-requested",
    title: "Codigo no solicitado",
    summary: "Existe componente esperado y ya hay pre-BOM, pero nadie pidio el codigo.",
    project: buildScenarioProject(scenario5Project, scenario5Items),
    itemExpectations: [
      {
        itemKey: "PM-FRASCO",
        originMode: ProjectItemOriginMode.PM_EXPECTED,
        expectedStatus: ProjectItemExpectedStatus.EXPECTED,
        matchingStatus: MatchingStatus.INFERRED,
        expectedItemStatus: "WAITING_CODE",
        readinessRange: [25, 40],
        requiredAlerts: ["CODE_NOT_REQUESTED", "APPROVED_DOCUMENT_MISSING"]
      }
    ],
    projectExpectation: {
      healthRange: [55, 70],
      canClose: false
    }
  },
  {
    id: "internal-technical-docs-missing",
    title: "Documentacion tecnica faltante",
    summary: "El material ya existe, pero faltan especificacion y ficha tecnica interna.",
    project: buildScenarioProject(scenario6Project, scenario6Items),
    itemExpectations: [
      {
        itemKey: "ETIQUETA-VALIDACION",
        originMode: ProjectItemOriginMode.BOM_DETECTED,
        expectedStatus: ProjectItemExpectedStatus.EVIDENCED,
        matchingStatus: MatchingStatus.EXACT,
        expectedItemStatus: "WAITING_DOCS",
        readinessRange: [40, 65],
        requiredAlerts: ["INTERNAL_TECH_DOCS_MISSING", "APPROVED_DOCUMENT_MISSING"]
      }
    ],
    projectExpectation: {
      healthRange: [50, 65],
      canClose: false
    }
  },
  {
    id: "approved-document-without-formalization",
    title: "Documento aprobado sin formalizacion suficiente",
    summary: "El circuito documental esta resuelto, pero todavia no existe material formal ni alta completa.",
    project: buildScenarioProject(scenario7Project, scenario7Items),
    itemExpectations: [
      {
        itemKey: "INSERT-VAL",
        originMode: ProjectItemOriginMode.REQUEST_DETECTED,
        expectedStatus: ProjectItemExpectedStatus.EVIDENCED,
        matchingStatus: MatchingStatus.INFERRED,
        expectedItemStatus: "WAITING_CODE",
        readinessRange: [55, 75],
        requiredAlerts: ["REQUEST_WITHOUT_FORMAL_MATERIAL"]
      }
    ],
    projectExpectation: {
      healthRange: [50, 65],
      canClose: false
    }
  },
  {
    id: "almost-complete-case",
    title: "Caso casi completo",
    summary: "El caso tiene cobertura total y un item ya listo; queda un componente critico en revision final.",
    project: buildScenarioProject(scenario8Project, scenario8Items),
    itemExpectations: [
      {
        itemKey: "ESTUCHE-READY",
        originMode: ProjectItemOriginMode.PM_EXPECTED,
        expectedStatus: ProjectItemExpectedStatus.EXPECTED,
        matchingStatus: MatchingStatus.EXACT,
        expectedItemStatus: "READY",
        readinessRange: [95, 100],
        requiredAlerts: []
      },
      {
        itemKey: "ETIQUETA-REVIEW",
        originMode: ProjectItemOriginMode.PM_EXPECTED,
        expectedStatus: ProjectItemExpectedStatus.EXPECTED,
        matchingStatus: MatchingStatus.EXACT,
        expectedItemStatus: "WAITING_DOCS",
        readinessRange: [85, 95],
        requiredAlerts: ["APPROVED_DOCUMENT_MISSING"]
      }
    ],
    projectExpectation: {
      healthRange: [85, 92],
      canClose: false
    }
  }
];
