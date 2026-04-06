import {
  ApplicabilityStatus,
  AlertSeverity,
  AlertStatus,
  BusinessUnit,
  ComponentSlot,
  MaterialRequestStatus,
  MaterialType,
  MatchingStatus,
  MoondeskTaskStatus,
  MoondeskTaskType,
  ProjectItemExpectedStatus,
  ProjectItemIdentificationStatus,
  ProjectItemOriginMode,
  ProjectItemStatus,
  ProjectStatus,
  ReviewDecision
} from "@prisma/client";

const now = new Date("2026-04-03T10:00:00.000Z");

const projects = [
  {
    id: "mock-project-cos",
    code: "COS-2026-001",
    name: "Relanzamiento Dermacalm 30 ml",
    caseType: "relaunch",
    changeDriver: "commercial_visible",
    presentation: "30 ml",
    activeIngredient: null,
    sapFinishedCode: "PT-COS-3011",
    scopeDefined: "DEFINED",
    status: ProjectStatus.ACTIVE,
    healthScore: 71,
    macroStatus: "Packaging en ejecucion",
    targetLaunchDate: new Date("2026-06-15"),
    product: {
      name: "Dermacalm Serum",
      presentation: "30 ml"
    },
    _count: {
      projectItems: 3,
      alerts: 2
    }
  },
  {
    id: "mock-project-pha",
    code: "PHA-2026-014",
    name: "Actualizacion prospecto Cefalexin",
    caseType: "regulatory_update",
    changeDriver: "regulatory",
    presentation: "250 mg / 5 ml",
    activeIngredient: "Cefalexina",
    sapFinishedCode: "PT-PHA-2505",
    scopeDefined: "PARTIAL",
    status: ProjectStatus.BLOCKED,
    healthScore: 48,
    macroStatus: "Esperando revision regulatoria",
    targetLaunchDate: new Date("2026-04-20"),
    product: {
      name: "Cefalexin Suspension",
      presentation: "250 mg / 5 ml"
    },
    _count: {
      projectItems: 1,
      alerts: 1
    }
  }
];

const projectItems = [
  {
    id: "mock-item-box",
    itemKey: "ESTUCHE-30",
    name: "Estuche 30 ml",
    componentSlot: ComponentSlot.ESTUCHE,
    applicabilityStatus: ApplicabilityStatus.APPLIES,
    originMode: ProjectItemOriginMode.BOM_DETECTED,
    provisional: false,
    expectedStatus: ProjectItemExpectedStatus.EVIDENCED,
    identificationStatus: ProjectItemIdentificationStatus.IDENTIFIED,
    matchingStatus: MatchingStatus.EXACT,
    status: ProjectItemStatus.IN_PROGRESS,
    readinessScore: 86,
    criticality: "CRITICAL",
    expectedMaterialCode: "MAT-EST-001",
    projectId: "mock-project-cos",
    project: { code: "COS-2026-001" },
    materialMaster: { materialCode: "MAT-EST-001" },
    alerts: []
  },
  {
    id: "mock-item-label",
    itemKey: "ETIQUETA-FRONTAL",
    name: "Etiqueta frontal",
    componentSlot: ComponentSlot.ETIQUETA,
    applicabilityStatus: ApplicabilityStatus.APPLIES,
    originMode: ProjectItemOriginMode.BOM_DETECTED,
    provisional: false,
    expectedStatus: ProjectItemExpectedStatus.EVIDENCED,
    identificationStatus: ProjectItemIdentificationStatus.IDENTIFIED,
    matchingStatus: MatchingStatus.EXACT,
    status: ProjectItemStatus.WAITING_DOCS,
    readinessScore: 58,
    criticality: "HIGH",
    expectedMaterialCode: "MAT-ETQ-014",
    projectId: "mock-project-cos",
    project: { code: "COS-2026-001" },
    materialMaster: { materialCode: "MAT-ETQ-014" },
    alerts: [
      {
        id: "mock-alert-tech-doc",
        severity: AlertSeverity.WARNING,
        title: "Material con documentacion tecnica incompleta"
      }
    ]
  },
  {
    id: "mock-item-bottle",
    itemKey: "FRASCO-30",
    name: "Frasco PET 30 ml",
    componentSlot: ComponentSlot.FRASCO,
    applicabilityStatus: ApplicabilityStatus.APPLIES,
    originMode: ProjectItemOriginMode.BOM_DETECTED,
    provisional: true,
    expectedStatus: ProjectItemExpectedStatus.EVIDENCED,
    identificationStatus: ProjectItemIdentificationStatus.PARTIALLY_IDENTIFIED,
    matchingStatus: MatchingStatus.INFERRED,
    status: ProjectItemStatus.WAITING_CODE,
    readinessScore: 24,
    criticality: "CRITICAL",
    expectedMaterialCode: "MAT-FRA-090",
    projectId: "mock-project-cos",
    project: { code: "COS-2026-001" },
    materialMaster: null,
    alerts: [
      {
        id: "mock-alert-missing-material",
        severity: AlertSeverity.CRITICAL,
        title: "BOM sin material asociado"
      }
    ]
  },
  {
    id: "mock-item-leaflet",
    itemKey: "PROSPECTO-REG",
    name: "Prospecto regulatorio",
    componentSlot: ComponentSlot.PROSPECTO,
    applicabilityStatus: ApplicabilityStatus.APPLIES,
    originMode: ProjectItemOriginMode.BOM_DETECTED,
    provisional: false,
    expectedStatus: ProjectItemExpectedStatus.EVIDENCED,
    identificationStatus: ProjectItemIdentificationStatus.IDENTIFIED,
    matchingStatus: MatchingStatus.EXACT,
    status: ProjectItemStatus.BLOCKED,
    readinessScore: 39,
    criticality: "CRITICAL",
    expectedMaterialCode: "MAT-PRO-033",
    projectId: "mock-project-pha",
    project: { code: "PHA-2026-014" },
    materialMaster: { materialCode: "MAT-PRO-033" },
    alerts: [
      {
        id: "mock-alert-review",
        severity: AlertSeverity.CRITICAL,
        title: "Diseno completado sin revision"
      }
    ]
  }
];

const alerts = [
  {
    id: "mock-alert-missing-material",
    title: "BOM sin material asociado",
    message: "El BOM requiere el frasco PET 30 ml y no existe material master vinculado.",
    severity: AlertSeverity.CRITICAL,
    status: AlertStatus.OPEN,
    createdAt: now,
    project: { code: "COS-2026-001" },
    projectItem: { name: "Frasco PET 30 ml" }
  },
  {
    id: "mock-alert-tech-doc",
    title: "Material con documentacion tecnica incompleta",
    message: "La etiqueta frontal tiene codigo de material pero no tiene ficha tecnica cargada.",
    severity: AlertSeverity.WARNING,
    status: AlertStatus.OPEN,
    createdAt: now,
    project: { code: "COS-2026-001" },
    projectItem: { name: "Etiqueta frontal" }
  },
  {
    id: "mock-alert-review",
    title: "Diseno completado sin revision",
    message: "La tarea de diseno del prospecto finalizo y no existe tarea de revision asociada.",
    severity: AlertSeverity.CRITICAL,
    status: AlertStatus.OPEN,
    createdAt: now,
    project: { code: "PHA-2026-014" },
    projectItem: { name: "Prospecto regulatorio" }
  }
];

const projectDetails = {
  "mock-project-cos": {
    id: "mock-project-cos",
    code: "COS-2026-001",
    name: "Relanzamiento Dermacalm 30 ml",
    status: ProjectStatus.ACTIVE,
    healthScore: 71,
    targetLaunchDate: new Date("2026-06-15"),
    product: {
      name: "Dermacalm Serum",
      presentation: "30 ml"
    },
    projectItems: projectItems.filter((item) => item.projectId === "mock-project-cos"),
    bomItems: [
      {
        id: "mock-bom-box",
        componentKey: "ESTUCHE-30",
        componentName: "Estuche 30 ml",
        componentType: "BOX",
        expectedMaterialCode: "MAT-EST-001"
      },
      {
        id: "mock-bom-label",
        componentKey: "ETIQUETA-FRONTAL",
        componentName: "Etiqueta frontal",
        componentType: "LABEL",
        expectedMaterialCode: "MAT-ETQ-014"
      },
      {
        id: "mock-bom-bottle",
        componentKey: "FRASCO-30",
        componentName: "Frasco PET 30 ml",
        componentType: "BOTTLE",
        expectedMaterialCode: "MAT-FRA-090"
      }
    ],
    materialRequests: [
      {
        id: "mock-request-bottle",
        requestCode: "REQ-26031",
        requestedDescription: "Frasco PET transparente 30 ml",
        requestStatus: MaterialRequestStatus.IN_PROGRESS,
        linkedMaterialCode: null
      }
    ],
    alerts: alerts.filter((alert) => alert.project.code === "COS-2026-001")
  },
  "mock-project-pha": {
    id: "mock-project-pha",
    code: "PHA-2026-014",
    name: "Actualizacion prospecto Cefalexin",
    status: ProjectStatus.BLOCKED,
    healthScore: 48,
    targetLaunchDate: new Date("2026-04-20"),
    product: {
      name: "Cefalexin Suspension",
      presentation: "250 mg / 5 ml"
    },
    projectItems: projectItems.filter((item) => item.projectId === "mock-project-pha"),
    bomItems: [
      {
        id: "mock-bom-leaflet",
        componentKey: "PROSPECTO-REG",
        componentName: "Prospecto regulatorio",
        componentType: "LEAFLET",
        expectedMaterialCode: "MAT-PRO-033"
      }
    ],
    materialRequests: [
      {
        id: "mock-request-leaflet",
        requestCode: "REQ-26012",
        requestedDescription: "Prospecto actualizado por cambio regulatorio",
        requestStatus: MaterialRequestStatus.COMPLETED,
        linkedMaterialCode: "MAT-PRO-033"
      }
    ],
    alerts: alerts.filter((alert) => alert.project.code === "PHA-2026-014")
  }
} satisfies Record<string, unknown>;

export function isMockPreviewEnabled() {
  return !process.env.DATABASE_URL;
}

export const mockData = {
  dashboard: {
    totals: {
      totalProjects: 2,
      activeProjects: 1,
      blockedProjects: 1,
      totalItems: 4,
      readyItems: 0,
      openAlerts: 3,
      criticalAlerts: 2
    },
    atRiskProjects: projects.filter((project) => project.healthScore < 60 || project.status === ProjectStatus.BLOCKED),
    recentAlerts: alerts
  },
  projects,
  projectItems,
  alerts,
  projectDetails,
  materials: [
    {
      id: "mock-material-box",
      materialCode: "MAT-EST-001",
      materialType: MaterialType.SECONDARY_PACKAGING,
      description: "Estuche Dermacalm 30 ml"
    },
    {
      id: "mock-material-label",
      materialCode: "MAT-ETQ-014",
      materialType: MaterialType.LABEL,
      description: "Etiqueta frontal Dermacalm 30 ml"
    }
  ],
  moondeskTasks: [
    {
      id: "mock-task-design",
      projectItemId: "mock-item-box",
      taskType: MoondeskTaskType.DESIGN_REQUEST,
      taskStatus: MoondeskTaskStatus.COMPLETED,
      title: "Arte estuche Dermacalm 30 ml",
      reviewDecision: ReviewDecision.PENDING
    }
  ]
};
