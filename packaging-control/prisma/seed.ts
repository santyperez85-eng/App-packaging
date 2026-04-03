import {
  AlertSeverity,
  AlertStatus,
  BusinessUnit,
  CheckStatus,
  CheckType,
  ItemCriticality,
  ItemType,
  MaterialRequestStatus,
  MaterialType,
  MoondeskTaskStatus,
  MoondeskTaskType,
  PrismaClient,
  ProjectItemStatus,
  ProjectStatus,
  ReviewDecision
} from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const pmUser = await prisma.user.upsert({
    where: { email: "pm.packaging@example.com" },
    update: {},
    create: {
      email: "pm.packaging@example.com",
      fullName: "Lucia Ferreyra",
      role: "PM"
    }
  });

  await prisma.user.upsert({
    where: { email: "design.lead@example.com" },
    update: {},
    create: {
      email: "design.lead@example.com",
      fullName: "Martin Quiroga",
      role: "DESIGN"
    }
  });

  const dermacalm = await prisma.product.upsert({
    where: { referenceCode: "COS-DERMA-30" },
    update: {},
    create: {
      referenceCode: "COS-DERMA-30",
      name: "Dermacalm Serum",
      businessUnit: BusinessUnit.COSMETIC,
      category: "Skincare",
      presentation: "30 ml"
    }
  });

  const cefalexin = await prisma.product.upsert({
    where: { referenceCode: "PHA-CEF-250" },
    update: {},
    create: {
      referenceCode: "PHA-CEF-250",
      name: "Cefalexin Suspension",
      businessUnit: BusinessUnit.PHARMA,
      category: "Antibioticos",
      presentation: "250 mg / 5 ml"
    }
  });

  const projectCosmetic = await prisma.project.upsert({
    where: { code: "COS-2026-001" },
    update: {},
    create: {
      code: "COS-2026-001",
      name: "Relanzamiento Dermacalm 30 ml",
      businessUnit: BusinessUnit.COSMETIC,
      productId: dermacalm.id,
      ownerId: pmUser.id,
      status: ProjectStatus.ACTIVE,
      macroStatus: "Packaging en ejecucion",
      healthScore: 71,
      sourcePmKey: "pm-cos-2026-001",
      startDate: new Date("2026-03-01"),
      targetLaunchDate: new Date("2026-06-15")
    }
  });

  const projectPharma = await prisma.project.upsert({
    where: { code: "PHA-2026-014" },
    update: {},
    create: {
      code: "PHA-2026-014",
      name: "Actualizacion prospecto Cefalexin",
      businessUnit: BusinessUnit.PHARMA,
      productId: cefalexin.id,
      ownerId: pmUser.id,
      status: ProjectStatus.BLOCKED,
      macroStatus: "Esperando revision regulatoria",
      healthScore: 48,
      sourcePmKey: "pm-pha-2026-014",
      startDate: new Date("2026-02-10"),
      targetLaunchDate: new Date("2026-04-20")
    }
  });

  const boxMaterial = await prisma.materialsMaster.upsert({
    where: { materialCode: "MAT-EST-001" },
    update: {},
    create: {
      materialCode: "MAT-EST-001",
      rootCode: "EST-001",
      versionLabel: "v3",
      materialType: MaterialType.SECONDARY_PACKAGING,
      description: "Estuche Dermacalm 30 ml",
      format: "Cartulina folding box",
      measures: "120x50x35 mm",
      supplier: "Cartones del Sur",
      drawingCode: "PL-EST-001",
      specificationCode: "ESP-EST-001",
      technicalSheetCode: "FT-EST-001",
      observations: "Apto para relanzamiento"
    }
  });

  const labelMaterial = await prisma.materialsMaster.upsert({
    where: { materialCode: "MAT-ETQ-014" },
    update: {},
    create: {
      materialCode: "MAT-ETQ-014",
      rootCode: "ETQ-014",
      versionLabel: "v2",
      materialType: MaterialType.LABEL,
      description: "Etiqueta frontal Dermacalm 30 ml",
      format: "BOPP blanco",
      measures: "80x35 mm",
      supplier: "Etiquetas Delta",
      drawingCode: "PL-ETQ-014",
      specificationCode: "ESP-ETQ-014",
      observations: "Falta actualizar ficha tecnica"
    }
  });

  const leafletMaterial = await prisma.materialsMaster.upsert({
    where: { materialCode: "MAT-PRO-033" },
    update: {},
    create: {
      materialCode: "MAT-PRO-033",
      rootCode: "PRO-033",
      versionLabel: "v5",
      materialType: MaterialType.LEAFLET,
      description: "Prospecto Cefalexin 250 mg / 5 ml",
      format: "Papel obra 45 g",
      measures: "250x180 mm",
      supplier: "Graficas Norte",
      specificationCode: "ESP-PRO-033",
      technicalSheetCode: "FT-PRO-033"
    }
  });

  const cosmeticBoxBom = await prisma.bomItem.upsert({
    where: {
      projectId_componentKey: {
        projectId: projectCosmetic.id,
        componentKey: "ESTUCHE-30"
      }
    },
    update: {},
    create: {
      projectId: projectCosmetic.id,
      componentKey: "ESTUCHE-30",
      componentName: "Estuche 30 ml",
      componentType: ItemType.BOX,
      quantity: 1,
      unit: "EA",
      isPackaging: true,
      isCritical: true,
      expectedMaterialCode: "MAT-EST-001"
    }
  });

  const cosmeticLabelBom = await prisma.bomItem.upsert({
    where: {
      projectId_componentKey: {
        projectId: projectCosmetic.id,
        componentKey: "ETIQUETA-FRONTAL"
      }
    },
    update: {},
    create: {
      projectId: projectCosmetic.id,
      componentKey: "ETIQUETA-FRONTAL",
      componentName: "Etiqueta frontal",
      componentType: ItemType.LABEL,
      quantity: 1,
      unit: "EA",
      isPackaging: true,
      isCritical: true,
      expectedMaterialCode: "MAT-ETQ-014"
    }
  });

  const cosmeticBottleBom = await prisma.bomItem.upsert({
    where: {
      projectId_componentKey: {
        projectId: projectCosmetic.id,
        componentKey: "FRASCO-30"
      }
    },
    update: {},
    create: {
      projectId: projectCosmetic.id,
      componentKey: "FRASCO-30",
      componentName: "Frasco PET 30 ml",
      componentType: ItemType.BOTTLE,
      quantity: 1,
      unit: "EA",
      isPackaging: true,
      isCritical: true,
      expectedMaterialCode: "MAT-FRA-090"
    }
  });

  const pharmaLeafletBom = await prisma.bomItem.upsert({
    where: {
      projectId_componentKey: {
        projectId: projectPharma.id,
        componentKey: "PROSPECTO-REG"
      }
    },
    update: {},
    create: {
      projectId: projectPharma.id,
      componentKey: "PROSPECTO-REG",
      componentName: "Prospecto regulatorio",
      componentType: ItemType.LEAFLET,
      quantity: 1,
      unit: "EA",
      isPackaging: true,
      isCritical: true,
      expectedMaterialCode: "MAT-PRO-033"
    }
  });

  const bottleRequest = await prisma.materialRequest.upsert({
    where: { sourceExternalId: "req-cos-bottle-001" },
    update: {},
    create: {
      sourceExternalId: "req-cos-bottle-001",
      projectId: projectCosmetic.id,
      requestCode: "REQ-26031",
      requestDate: new Date("2026-03-14"),
      requestedById: pmUser.id,
      requestedByName: "Lucia Ferreyra",
      materialType: MaterialType.PRIMARY_PACKAGING,
      requestedDescription: "Frasco PET transparente 30 ml",
      requestStatus: MaterialRequestStatus.IN_PROGRESS
    }
  });

  const leafletRequest = await prisma.materialRequest.upsert({
    where: { sourceExternalId: "req-pha-leaflet-001" },
    update: {},
    create: {
      sourceExternalId: "req-pha-leaflet-001",
      projectId: projectPharma.id,
      requestCode: "REQ-26012",
      requestDate: new Date("2026-02-18"),
      requestedById: pmUser.id,
      requestedByName: "Lucia Ferreyra",
      materialType: MaterialType.LEAFLET,
      requestedDescription: "Prospecto actualizado por cambio regulatorio",
      requestStatus: MaterialRequestStatus.COMPLETED,
      linkedMaterialCode: "MAT-PRO-033",
      linkedMaterialId: leafletMaterial.id
    }
  });

  const itemBox = await prisma.projectItem.upsert({
    where: {
      projectId_itemKey: {
        projectId: projectCosmetic.id,
        itemKey: "ESTUCHE-30"
      }
    },
    update: {},
    create: {
      projectId: projectCosmetic.id,
      itemKey: "ESTUCHE-30",
      bomItemId: cosmeticBoxBom.id,
      materialMasterId: boxMaterial.id,
      name: "Estuche 30 ml",
      itemType: ItemType.BOX,
      criticality: ItemCriticality.CRITICAL,
      status: ProjectItemStatus.IN_PROGRESS,
      readinessScore: 86,
      expectedMaterialCode: "MAT-EST-001"
    }
  });

  const itemLabel = await prisma.projectItem.upsert({
    where: {
      projectId_itemKey: {
        projectId: projectCosmetic.id,
        itemKey: "ETIQUETA-FRONTAL"
      }
    },
    update: {},
    create: {
      projectId: projectCosmetic.id,
      itemKey: "ETIQUETA-FRONTAL",
      bomItemId: cosmeticLabelBom.id,
      materialMasterId: labelMaterial.id,
      name: "Etiqueta frontal",
      itemType: ItemType.LABEL,
      criticality: ItemCriticality.HIGH,
      status: ProjectItemStatus.WAITING_DOCS,
      readinessScore: 58,
      expectedMaterialCode: "MAT-ETQ-014"
    }
  });

  const itemBottle = await prisma.projectItem.upsert({
    where: {
      projectId_itemKey: {
        projectId: projectCosmetic.id,
        itemKey: "FRASCO-30"
      }
    },
    update: {},
    create: {
      projectId: projectCosmetic.id,
      itemKey: "FRASCO-30",
      bomItemId: cosmeticBottleBom.id,
      materialRequestId: bottleRequest.id,
      name: "Frasco PET 30 ml",
      itemType: ItemType.BOTTLE,
      criticality: ItemCriticality.CRITICAL,
      status: ProjectItemStatus.WAITING_CODE,
      readinessScore: 24,
      expectedMaterialCode: "MAT-FRA-090"
    }
  });

  const itemLeaflet = await prisma.projectItem.upsert({
    where: {
      projectId_itemKey: {
        projectId: projectPharma.id,
        itemKey: "PROSPECTO-REG"
      }
    },
    update: {},
    create: {
      projectId: projectPharma.id,
      itemKey: "PROSPECTO-REG",
      bomItemId: pharmaLeafletBom.id,
      materialRequestId: leafletRequest.id,
      materialMasterId: leafletMaterial.id,
      name: "Prospecto regulatorio",
      itemType: ItemType.LEAFLET,
      criticality: ItemCriticality.CRITICAL,
      status: ProjectItemStatus.BLOCKED,
      readinessScore: 39,
      expectedMaterialCode: "MAT-PRO-033",
      versioningRecommendation: "NEW_ROOT_CODE_CANDIDATE"
    }
  });

  const designTaskBox = await prisma.moondeskTask.upsert({
    where: { externalTaskId: "md-task-1001" },
    update: {},
    create: {
      externalTaskId: "md-task-1001",
      projectItemId: itemBox.id,
      taskType: MoondeskTaskType.DESIGN_REQUEST,
      taskStatus: MoondeskTaskStatus.COMPLETED,
      title: "Arte estuche Dermacalm 30 ml",
      dueDate: new Date("2026-03-28"),
      assignedDesigner: "Martin Quiroga",
      versionsCount: 3,
      latestVersionLabel: "v3",
      approvedVersionAvailable: true
    }
  });

  await prisma.moondeskTask.upsert({
    where: { externalTaskId: "md-task-1002" },
    update: {},
    create: {
      externalTaskId: "md-task-1002",
      projectItemId: itemBox.id,
      taskType: MoondeskTaskType.REVIEW_REQUEST,
      taskStatus: MoondeskTaskStatus.IN_PROGRESS,
      title: "Revision estuche Dermacalm 30 ml",
      dueDate: new Date("2026-04-05"),
      assignedDesigner: "QA Packaging",
      versionsCount: 1,
      latestVersionLabel: "v3",
      reviewDecision: ReviewDecision.PENDING
    }
  });

  await prisma.moondeskTask.upsert({
    where: { externalTaskId: "md-task-2001" },
    update: {},
    create: {
      externalTaskId: "md-task-2001",
      projectItemId: itemLeaflet.id,
      taskType: MoondeskTaskType.DESIGN_REQUEST,
      taskStatus: MoondeskTaskStatus.COMPLETED,
      title: "Actualizacion prospecto Cefalexin",
      dueDate: new Date("2026-03-20"),
      assignedDesigner: "Martin Quiroga",
      versionsCount: 2,
      latestVersionLabel: "v5",
      approvedVersionAvailable: false
    }
  });

  await prisma.technicalCheck.createMany({
    data: [
      {
        projectItemId: itemBox.id,
        checkType: CheckType.MATERIAL_CODE,
        status: CheckStatus.PASSED,
        isBlocking: true,
        notes: "Codigo valido en maestro"
      },
      {
        projectItemId: itemLabel.id,
        checkType: CheckType.TECHNICAL_SHEET,
        status: CheckStatus.FAILED,
        isBlocking: true,
        notes: "Falta ficha tecnica vigente"
      },
      {
        projectItemId: itemBottle.id,
        checkType: CheckType.MATERIAL_CODE,
        status: CheckStatus.FAILED,
        isBlocking: true,
        notes: "Todavia no existe codigo de material"
      },
      {
        projectItemId: itemLeaflet.id,
        checkType: CheckType.APPROVED_DOCUMENT,
        status: CheckStatus.FAILED,
        isBlocking: true,
        notes: "No hay documento aprobado en Moondesk"
      }
    ],
    skipDuplicates: true
  });

  await prisma.alert.createMany({
    data: [
      {
        projectId: projectCosmetic.id,
        projectItemId: itemBottle.id,
        type: "MISSING_MATERIAL",
        title: "BOM sin material asociado",
        message: "El BOM requiere el frasco PET 30 ml y no existe material master vinculado.",
        severity: AlertSeverity.CRITICAL,
        status: AlertStatus.OPEN,
        ruleCode: "BOM_COMPONENT_WITHOUT_MATERIAL"
      },
      {
        projectId: projectCosmetic.id,
        projectItemId: itemLabel.id,
        type: "MISSING_TECH_DOC",
        title: "Material con documentacion tecnica incompleta",
        message: "La etiqueta frontal tiene codigo de material pero no tiene ficha tecnica cargada.",
        severity: AlertSeverity.WARNING,
        status: AlertStatus.OPEN,
        ruleCode: "MATERIAL_MISSING_TECHNICAL_SHEET"
      },
      {
        projectId: projectPharma.id,
        projectItemId: itemLeaflet.id,
        type: "MISSING_REVIEW_TASK",
        title: "Diseno completado sin revision",
        message: "La tarea de diseno del prospecto finalizo y no existe tarea de revision asociada.",
        severity: AlertSeverity.CRITICAL,
        status: AlertStatus.OPEN,
        ruleCode: "DESIGN_WITHOUT_REVIEW"
      }
    ],
    skipDuplicates: true
  });

  await prisma.moondeskVersion.upsert({
    where: { id: `${designTaskBox.id}-v3` },
    update: {},
    create: {
      id: `${designTaskBox.id}-v3`,
      moondeskTaskId: designTaskBox.id,
      versionLabel: "v3",
      isLatest: true,
      approved: true
    }
  });

  await prisma.importPmRow.createMany({
    data: [
      {
        batchId: "seed-batch-pm",
        sourceFileName: "pm_launches.xlsx",
        sheetName: "Projects",
        rowNumber: 2,
        projectCode: "COS-2026-001",
        projectName: "Relanzamiento Dermacalm 30 ml",
        productReference: "COS-DERMA-30",
        productName: "Dermacalm Serum",
        presentation: "30 ml",
        businessUnit: BusinessUnit.COSMETIC,
        macroStatus: "Packaging en ejecucion",
        startDate: new Date("2026-03-01"),
        targetLaunchDate: new Date("2026-06-15"),
        rawData: {
          project_code: "COS-2026-001",
          product_name: "Dermacalm Serum",
          macro_status: "Packaging en ejecucion"
        }
      },
      {
        batchId: "seed-batch-pm",
        sourceFileName: "pm_launches.xlsx",
        sheetName: "Projects",
        rowNumber: 3,
        projectCode: "PHA-2026-014",
        projectName: "Actualizacion prospecto Cefalexin",
        productReference: "PHA-CEF-250",
        productName: "Cefalexin Suspension",
        presentation: "250 mg / 5 ml",
        businessUnit: BusinessUnit.PHARMA,
        macroStatus: "Esperando revision regulatoria",
        startDate: new Date("2026-02-10"),
        targetLaunchDate: new Date("2026-04-20"),
        rawData: {
          project_code: "PHA-2026-014",
          product_name: "Cefalexin Suspension",
          macro_status: "Esperando revision regulatoria"
        }
      }
    ],
    skipDuplicates: true
  });

  await prisma.importMaterialMasterRow.createMany({
    data: [
      {
        batchId: "seed-batch-materials",
        sourceFileName: "materials_master.xlsx",
        sheetName: "Master",
        rowNumber: 2,
        materialCode: "MAT-FRA-090",
        materialType: "PRIMARY_PACKAGING",
        description: "Frasco PET transparente 30 ml",
        format: "PET",
        measures: "30 ml",
        observations: "Pendiente alta SAP",
        rawData: {
          material_code: "MAT-FRA-090",
          description: "Frasco PET transparente 30 ml"
        }
      }
    ],
    skipDuplicates: true
  });

  await prisma.importBomRow.createMany({
    data: [
      {
        batchId: "seed-batch-bom",
        sourceFileName: "launch_bom.xlsx",
        sheetName: "BOM",
        rowNumber: 2,
        projectCode: "COS-2026-001",
        componentKey: "FRASCO-30",
        componentName: "Frasco PET 30 ml",
        componentType: "BOTTLE",
        quantity: 1,
        unit: "EA",
        isPackaging: true,
        expectedMaterialCode: "MAT-FRA-090",
        rawData: {
          project_code: "COS-2026-001",
          component_name: "Frasco PET 30 ml"
        }
      }
    ],
    skipDuplicates: true
  });

  await prisma.importMaterialRequestRow.createMany({
    data: [
      {
        batchId: "seed-batch-requests",
        sourceFileName: "material_requests.xlsx",
        sheetName: "Requests",
        rowNumber: 2,
        projectCode: "COS-2026-001",
        requestCode: "REQ-26031",
        requestDate: new Date("2026-03-14"),
        requestedBy: "Lucia Ferreyra",
        materialType: "PRIMARY_PACKAGING",
        requestedDescription: "Frasco PET transparente 30 ml",
        requestStatus: "IN_PROGRESS",
        linkedMaterialCode: null,
        rawData: {
          request_code: "REQ-26031",
          requested_description: "Frasco PET transparente 30 ml"
        }
      }
    ],
    skipDuplicates: true
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
