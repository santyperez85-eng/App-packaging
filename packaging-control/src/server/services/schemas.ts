import { z } from "zod";

export const projectInputSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  businessUnit: z.enum(["PHARMA", "COSMETIC"]),
  productId: z.string().cuid().optional().nullable(),
  ownerId: z.string().cuid().optional().nullable(),
  sourcePmKey: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  macroStatus: z.string().optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
  targetLaunchDate: z.coerce.date().optional().nullable(),
  status: z.enum(["PLANNING", "ACTIVE", "BLOCKED", "READY_TO_CLOSE", "CLOSED"]).optional()
});

export const projectItemInputSchema = z.object({
  projectId: z.string().cuid(),
  itemKey: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  itemType: z
    .enum(["BOX", "LABEL", "BOTTLE", "LEAFLET", "INSERT", "TUBE", "CAP", "SACHET", "OTHER"])
    .optional(),
  criticality: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  bomItemId: z.string().cuid().optional().nullable(),
  materialRequestId: z.string().cuid().optional().nullable(),
  materialMasterId: z.string().cuid().optional().nullable(),
  expectedMaterialCode: z.string().optional().nullable(),
  requiresApprovedDocument: z.boolean().optional(),
  requiresMaterialCode: z.boolean().optional(),
  requiresTechnicalDocs: z.boolean().optional()
});

export const materialMasterInputSchema = z.object({
  materialCode: z.string().min(1),
  rootCode: z.string().optional().nullable(),
  versionLabel: z.string().optional().nullable(),
  materialType: z
    .enum(["PRIMARY_PACKAGING", "SECONDARY_PACKAGING", "LEAFLET", "LABEL", "COMPONENT", "OTHER"])
    .optional(),
  description: z.string().min(1),
  format: z.string().optional().nullable(),
  measures: z.string().optional().nullable(),
  supplier: z.string().optional().nullable(),
  drawingCode: z.string().optional().nullable(),
  specificationCode: z.string().optional().nullable(),
  technicalSheetCode: z.string().optional().nullable(),
  observations: z.string().optional().nullable(),
  changeHistoryText: z.string().optional().nullable(),
  activeFlag: z.boolean().optional()
});

export const materialRequestInputSchema = z.object({
  sourceExternalId: z.string().optional().nullable(),
  projectId: z.string().cuid(),
  requestedById: z.string().cuid().optional().nullable(),
  requestCode: z.string().optional().nullable(),
  requestDate: z.coerce.date().optional().nullable(),
  requestedByName: z.string().optional().nullable(),
  materialType: z
    .enum(["PRIMARY_PACKAGING", "SECONDARY_PACKAGING", "LEAFLET", "LABEL", "COMPONENT", "OTHER"])
    .optional(),
  requestedDescription: z.string().min(1),
  requestStatus: z.enum(["REQUESTED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  linkedMaterialCode: z.string().optional().nullable(),
  linkedMaterialId: z.string().cuid().optional().nullable(),
  notes: z.string().optional().nullable()
});

export const bomItemInputSchema = z.object({
  projectId: z.string().cuid(),
  componentKey: z.string().min(1),
  componentName: z.string().min(1),
  componentType: z
    .enum(["BOX", "LABEL", "BOTTLE", "LEAFLET", "INSERT", "TUBE", "CAP", "SACHET", "OTHER"])
    .optional(),
  quantity: z.number().optional().nullable(),
  unit: z.string().optional().nullable(),
  isPackaging: z.boolean().optional(),
  isCritical: z.boolean().optional(),
  expectedMaterialCode: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
});

export const moondeskTaskInputSchema = z.object({
  externalTaskId: z.string().optional().nullable(),
  projectItemId: z.string().cuid(),
  taskType: z.enum(["DESIGN_REQUEST", "REVIEW_REQUEST", "ARTWORK", "DRAWING", "SPECIFICATION"]),
  taskStatus: z.enum(["TODO", "IN_PROGRESS", "COMPLETED", "BLOCKED", "CANCELLED"]).optional(),
  title: z.string().min(1),
  dueDate: z.coerce.date().optional().nullable(),
  assignedDesigner: z.string().optional().nullable(),
  versionsCount: z.number().int().optional(),
  latestVersionLabel: z.string().optional().nullable(),
  reviewDecision: z.enum(["PENDING", "APPROVED", "REJECTED", "CHANGES_REQUESTED"]).optional().nullable(),
  approvedVersionAvailable: z.boolean().optional(),
  comments: z.any().optional(),
  sourceUpdatedAt: z.coerce.date().optional().nullable()
});

export const alertInputSchema = z.object({
  projectId: z.string().cuid().optional().nullable(),
  projectItemId: z.string().cuid().optional().nullable(),
  type: z.string().min(1),
  title: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]).optional(),
  ruleCode: z.string().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  metadata: z.record(z.any()).optional()
});
