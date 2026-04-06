import {
  ApplicabilityStatus,
  ComponentSlot,
  MatchConfidence,
  MatchingStatus,
  Prisma,
  ProjectItemExpectedStatus,
  ProjectItemIdentificationStatus,
  ProjectItemOriginMode
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { inferComponentSlot, normalizeText, slugify } from "@/lib/utils";

type MatchableProjectItem = Prisma.ProjectItemGetPayload<{
  include: {
    materialMaster: true;
    materialRequest: true;
    bomItem: true;
    evidences: true;
  };
}>;

export type ProjectMatchContext = {
  id: string;
  code: string;
  sapFinishedCode?: string | null;
};

export type ProjectSourceMatch = {
  sourceType: string;
  sourceRecordKey: string;
  projectCode?: string | null;
  sapFinishedCode?: string | null;
};

export type ProjectMatchResolution = {
  project?: ProjectMatchContext;
  matchRule: string;
  matchConfidence: MatchConfidence;
  matchStatus: MatchingStatus;
};

export type ProjectItemMatchSource = {
  sourceType: string;
  sourceRecordKey: string;
  project: ProjectMatchContext;
  materialCode?: string | null;
  sapFinishedCode?: string | null;
  provisionalCode?: string | null;
  rawLabel?: string | null;
  description?: string | null;
  componentSlot?: ComponentSlot | null;
  originMode: ProjectItemOriginMode;
};

export type ProjectItemMatchResolution = {
  itemKey: string;
  itemName: string;
  componentSlot: ComponentSlot;
  applicabilityStatus: ApplicabilityStatus;
  originMode: ProjectItemOriginMode;
  provisional: boolean;
  expectedStatus: ProjectItemExpectedStatus;
  identificationStatus: ProjectItemIdentificationStatus;
  matchingStatus: MatchingStatus;
  provisionalCode?: string | null;
  matchRule: string;
  matchConfidence: MatchConfidence;
  evidenceMatchStatus: MatchingStatus;
  matchedProjectItemId?: string;
};

export const PROJECT_MATCH_PRIORITY = ["project_code_exact", "sap_finished_code_exact"] as const;
export const PROJECT_ITEM_MATCH_PRIORITY = [
  "material_code_exact",
  "sap_finished_code_exact",
  "provisional_code_exact",
  "normalized_description_within_case",
  "component_slot_within_case"
] as const;

const includeConfig = {
  materialMaster: true,
  materialRequest: true,
  bomItem: true,
  evidences: true
} satisfies Prisma.ProjectItemInclude;

function toProjectContext(project: { id: string; code: string; sapFinishedCode?: string | null }): ProjectMatchContext {
  return {
    id: project.id,
    code: project.code,
    sapFinishedCode: project.sapFinishedCode
  };
}

function deriveComponentSlot(source: ProjectItemMatchSource) {
  return source.componentSlot ?? inferComponentSlot(source.rawLabel ?? source.description ?? source.sourceRecordKey);
}

function deriveName(source: ProjectItemMatchSource) {
  return source.rawLabel ?? source.description ?? source.sourceRecordKey;
}

function buildPlaceholderItemKey(source: ProjectItemMatchSource) {
  if (source.originMode === ProjectItemOriginMode.PM_EXPECTED) {
    return `PM-${slugify(source.sourceRecordKey).toUpperCase()}`;
  }

  if (source.sourceType === "bom") {
    return source.sourceRecordKey;
  }

  if (source.provisionalCode) {
    return `REQ-${slugify(source.provisionalCode).toUpperCase()}`;
  }

  if (source.materialCode) {
    return `MAT-${slugify(source.materialCode).toUpperCase()}`;
  }

  return `${source.sourceType}-${slugify(source.sourceRecordKey).toUpperCase()}`;
}

function normalizedStrings(item: MatchableProjectItem) {
  return [
    normalizeText(item.name),
    normalizeText(item.description),
    normalizeText(item.bomItem?.componentName),
    normalizeText(item.materialRequest?.requestedDescription),
    normalizeText(item.materialMaster?.description),
    ...item.evidences.map((evidence) => normalizeText(evidence.rawLabel))
  ].filter(Boolean);
}

function uniqueCandidate(candidates: MatchableProjectItem[]) {
  return candidates.length === 1 ? candidates[0] : null;
}

function hasAmbiguity(candidates: MatchableProjectItem[]) {
  return candidates.length > 1;
}

function normalizeResolutionConsistency(
  resolution: ProjectItemMatchResolution,
  params: {
    hasMaterialIdentity: boolean;
    prefersExpectedState: boolean;
  }
): ProjectItemMatchResolution {
  const normalized = { ...resolution };

  if (params.prefersExpectedState && normalized.expectedStatus === ProjectItemExpectedStatus.EVIDENCED) {
    normalized.expectedStatus = ProjectItemExpectedStatus.EXPECTED;
  }

  if (normalized.matchingStatus === MatchingStatus.EXACT) {
    if (params.hasMaterialIdentity) {
      normalized.identificationStatus = ProjectItemIdentificationStatus.IDENTIFIED;
    } else {
      normalized.matchingStatus = MatchingStatus.INFERRED;
      normalized.evidenceMatchStatus = MatchingStatus.INFERRED;
    }
  }

  if (
    normalized.identificationStatus === ProjectItemIdentificationStatus.NOT_IDENTIFIED &&
    normalized.matchingStatus === MatchingStatus.EXACT
  ) {
    normalized.matchingStatus = MatchingStatus.INFERRED;
    normalized.evidenceMatchStatus = MatchingStatus.INFERRED;
  }

  return normalized;
}

function resolveFromExistingEvidence(
  evidence: Prisma.ProjectItemEvidenceGetPayload<{
    include: {
      projectItem: {
        include: typeof includeConfig;
      };
    };
  }>
): ProjectItemMatchResolution {
  const item = evidence.projectItem;

  return normalizeResolutionConsistency(
    {
      itemKey: item.itemKey,
      itemName: item.name,
      componentSlot: item.componentSlot,
      applicabilityStatus: item.applicabilityStatus,
      originMode: item.originMode,
      provisional: item.provisional,
      expectedStatus: item.expectedStatus,
      identificationStatus: item.identificationStatus,
      matchingStatus: evidence.matchStatus,
      provisionalCode: item.provisionalCode,
      matchRule: evidence.matchRule ?? "existing_evidence_reuse",
      matchConfidence: evidence.matchConfidence,
      evidenceMatchStatus: evidence.matchStatus,
      matchedProjectItemId: item.id
    },
    {
      hasMaterialIdentity: Boolean(item.materialMaster?.materialCode || item.expectedMaterialCode),
      prefersExpectedState: item.originMode === ProjectItemOriginMode.PM_EXPECTED
    }
  );
}

function buildResolvedMatch(
  item: MatchableProjectItem,
  source: ProjectItemMatchSource,
  params: {
    matchRule: string;
    matchConfidence: MatchConfidence;
    evidenceMatchStatus: MatchingStatus;
  }
): ProjectItemMatchResolution {
  const expectedStatus =
    source.originMode === ProjectItemOriginMode.PM_EXPECTED
      ? item.expectedStatus === ProjectItemExpectedStatus.NOT_EXPECTED ||
        item.expectedStatus === ProjectItemExpectedStatus.EVIDENCED
        ? ProjectItemExpectedStatus.EXPECTED
        : item.expectedStatus
      : item.originMode === ProjectItemOriginMode.PM_EXPECTED ||
          item.expectedStatus === ProjectItemExpectedStatus.EXPECTED ||
          item.expectedStatus === ProjectItemExpectedStatus.EXPECTED_BUT_MISSING
        ? item.expectedStatus
        : item.expectedStatus === ProjectItemExpectedStatus.NOT_EXPECTED
          ? ProjectItemExpectedStatus.EVIDENCED
          : item.expectedStatus;
  const identificationStatus =
    source.originMode === ProjectItemOriginMode.PM_EXPECTED
      ? item.identificationStatus
      : item.identificationStatus === ProjectItemIdentificationStatus.NOT_IDENTIFIED
        ? source.materialCode
          ? ProjectItemIdentificationStatus.IDENTIFIED
          : item.provisionalCode || source.provisionalCode
            ? ProjectItemIdentificationStatus.PARTIALLY_IDENTIFIED
            : ProjectItemIdentificationStatus.NOT_IDENTIFIED
        : item.identificationStatus;

  return normalizeResolutionConsistency(
    {
      itemKey: item.itemKey,
      itemName: item.name,
      componentSlot: item.componentSlot === ComponentSlot.OTRO ? deriveComponentSlot(source) : item.componentSlot,
      applicabilityStatus:
        item.applicabilityStatus === ApplicabilityStatus.UNKNOWN ? ApplicabilityStatus.APPLIES : item.applicabilityStatus,
      originMode: item.originMode === ProjectItemOriginMode.MANUAL ? source.originMode : item.originMode,
      provisional: item.provisional,
      expectedStatus,
      identificationStatus,
      matchingStatus: params.evidenceMatchStatus,
      provisionalCode: item.provisionalCode ?? source.provisionalCode ?? source.materialCode ?? null,
      matchRule: params.matchRule,
      matchConfidence: params.matchConfidence,
      evidenceMatchStatus: params.evidenceMatchStatus,
      matchedProjectItemId: item.id
    },
    {
      hasMaterialIdentity: Boolean(source.materialCode || item.materialMaster?.materialCode || item.expectedMaterialCode),
      prefersExpectedState:
        item.originMode === ProjectItemOriginMode.PM_EXPECTED || source.originMode === ProjectItemOriginMode.PM_EXPECTED
    }
  );
}

function buildNewItemResolution(
  source: ProjectItemMatchSource,
  params: {
    matchingStatus: MatchingStatus;
    matchRule: string;
    matchConfidence: MatchConfidence;
  }
): ProjectItemMatchResolution {
  const hasStrongIdentifier = Boolean(source.materialCode || source.provisionalCode);

  return normalizeResolutionConsistency(
    {
      itemKey: buildPlaceholderItemKey(source),
      itemName: deriveName(source),
      componentSlot: deriveComponentSlot(source),
      applicabilityStatus: ApplicabilityStatus.APPLIES,
      originMode: source.originMode,
      provisional: true,
      expectedStatus:
        source.originMode === ProjectItemOriginMode.PM_EXPECTED
          ? ProjectItemExpectedStatus.EXPECTED
          : ProjectItemExpectedStatus.EVIDENCED,
      identificationStatus: source.materialCode
        ? ProjectItemIdentificationStatus.IDENTIFIED
        : hasStrongIdentifier
          ? ProjectItemIdentificationStatus.PARTIALLY_IDENTIFIED
          : ProjectItemIdentificationStatus.NOT_IDENTIFIED,
      matchingStatus: params.matchingStatus,
      provisionalCode: source.provisionalCode ?? source.materialCode ?? null,
      matchRule: params.matchRule,
      matchConfidence: params.matchConfidence,
      evidenceMatchStatus: params.matchingStatus
    },
    {
      hasMaterialIdentity: Boolean(source.materialCode),
      prefersExpectedState: source.originMode === ProjectItemOriginMode.PM_EXPECTED
    }
  );
}

export async function resolveProjectForSource(source: ProjectSourceMatch): Promise<ProjectMatchResolution> {
  if (source.projectCode) {
    const project = await prisma.project.findUnique({
      where: { code: source.projectCode },
      select: {
        id: true,
        code: true,
        sapFinishedCode: true
      }
    });

    if (project) {
      if (
        source.sapFinishedCode &&
        project.sapFinishedCode &&
        source.sapFinishedCode !== project.sapFinishedCode
      ) {
        return {
          matchRule: "project_code_vs_sap_finished_code_conflict",
          matchConfidence: MatchConfidence.LOW,
          matchStatus: MatchingStatus.MANUAL_REVIEW
        };
      }

      return {
        project: toProjectContext(project),
        matchRule: PROJECT_MATCH_PRIORITY[0],
        matchConfidence: MatchConfidence.HIGH,
        matchStatus: MatchingStatus.EXACT
      };
    }
  }

  if (source.sapFinishedCode) {
    const projects = await prisma.project.findMany({
      where: { sapFinishedCode: source.sapFinishedCode },
      select: {
        id: true,
        code: true,
        sapFinishedCode: true
      }
    });

    const matchedProject = uniqueProject(projects);

    if (matchedProject) {
      return {
        project: toProjectContext(matchedProject),
        matchRule: PROJECT_MATCH_PRIORITY[1],
        matchConfidence: MatchConfidence.HIGH,
        matchStatus: MatchingStatus.EXACT
      };
    }

    if (projects.length > 1) {
      return {
        matchRule: "sap_finished_code_ambiguous",
        matchConfidence: MatchConfidence.LOW,
        matchStatus: MatchingStatus.MANUAL_REVIEW
      };
    }
  }

  return {
    matchRule: "project_not_resolved",
    matchConfidence: MatchConfidence.LOW,
    matchStatus: MatchingStatus.MANUAL_REVIEW
  };
}

function uniqueProject<T>(projects: T[]) {
  return projects.length === 1 ? projects[0] : null;
}

export async function resolveProjectItemMatch(source: ProjectItemMatchSource): Promise<ProjectItemMatchResolution> {
  if (
    source.sapFinishedCode &&
    source.project.sapFinishedCode &&
    source.sapFinishedCode !== source.project.sapFinishedCode
  ) {
    return buildNewItemResolution(source, {
      matchingStatus: MatchingStatus.MANUAL_REVIEW,
      matchRule: "sap_finished_code_conflict",
      matchConfidence: MatchConfidence.LOW
    });
  }

  const [items, existingEvidence] = await Promise.all([
    prisma.projectItem.findMany({
      where: {
        projectId: source.project.id
      },
      include: includeConfig
    }),
    prisma.projectItemEvidence.findFirst({
      where: {
        sourceType: source.sourceType,
        sourceRecordKey: source.sourceRecordKey,
        projectItem: {
          projectId: source.project.id
        }
      },
      include: {
        projectItem: {
          include: includeConfig
        }
      }
    })
  ]);

  if (source.originMode === ProjectItemOriginMode.PM_EXPECTED && existingEvidence) {
    return resolveFromExistingEvidence(existingEvidence);
  }

  if (source.materialCode) {
    const exactMaterialMatches = items.filter(
      (item) =>
        item.materialMaster?.materialCode === source.materialCode ||
        item.expectedMaterialCode === source.materialCode
    );
    const exactMaterialMatch = uniqueCandidate(exactMaterialMatches);

    if (exactMaterialMatch) {
      return buildResolvedMatch(exactMaterialMatch, source, {
        matchRule: PROJECT_ITEM_MATCH_PRIORITY[0],
        matchConfidence: MatchConfidence.HIGH,
        evidenceMatchStatus: MatchingStatus.EXACT
      });
    }

    if (hasAmbiguity(exactMaterialMatches)) {
      return buildNewItemResolution(source, {
        matchingStatus: MatchingStatus.MANUAL_REVIEW,
        matchRule: "material_code_ambiguous",
        matchConfidence: MatchConfidence.LOW
      });
    }
  }

  if (source.provisionalCode) {
    const provisionalMatches = items.filter(
      (item) =>
        item.provisionalCode === source.provisionalCode ||
        item.materialRequest?.requestCode === source.provisionalCode
    );
    const provisionalMatch = uniqueCandidate(provisionalMatches);

    if (provisionalMatch) {
      return buildResolvedMatch(provisionalMatch, source, {
        matchRule: PROJECT_ITEM_MATCH_PRIORITY[2],
        matchConfidence: MatchConfidence.HIGH,
        evidenceMatchStatus: MatchingStatus.EXACT
      });
    }

    if (hasAmbiguity(provisionalMatches)) {
      return buildNewItemResolution(source, {
        matchingStatus: MatchingStatus.MANUAL_REVIEW,
        matchRule: "provisional_code_ambiguous",
        matchConfidence: MatchConfidence.LOW
      });
    }
  }

  const normalizedLabel = normalizeText(source.rawLabel ?? source.description);

  if (normalizedLabel) {
    const descriptionMatches = items.filter((item) => normalizedStrings(item).includes(normalizedLabel));
    const descriptionMatch = uniqueCandidate(descriptionMatches);

    if (descriptionMatch) {
      return buildResolvedMatch(descriptionMatch, source, {
        matchRule: PROJECT_ITEM_MATCH_PRIORITY[3],
        matchConfidence: MatchConfidence.MEDIUM,
        evidenceMatchStatus: MatchingStatus.INFERRED
      });
    }

    if (hasAmbiguity(descriptionMatches)) {
      return buildNewItemResolution(source, {
        matchingStatus: MatchingStatus.MANUAL_REVIEW,
        matchRule: "normalized_description_ambiguous",
        matchConfidence: MatchConfidence.LOW
      });
    }
  }

  const resolvedComponentSlot = deriveComponentSlot(source);

  if (resolvedComponentSlot !== ComponentSlot.OTRO) {
    const componentSlotMatches = items.filter((item) => item.componentSlot === resolvedComponentSlot);
    const componentSlotMatch = uniqueCandidate(componentSlotMatches);

    if (componentSlotMatch) {
      return buildResolvedMatch(componentSlotMatch, source, {
        matchRule: PROJECT_ITEM_MATCH_PRIORITY[4],
        matchConfidence: MatchConfidence.LOW,
        evidenceMatchStatus: MatchingStatus.INFERRED
      });
    }

    if (hasAmbiguity(componentSlotMatches)) {
      return buildNewItemResolution(source, {
        matchingStatus: MatchingStatus.MANUAL_REVIEW,
        matchRule: "component_slot_ambiguous",
        matchConfidence: MatchConfidence.LOW
      });
    }
  }

  if (existingEvidence) {
    return resolveFromExistingEvidence(existingEvidence);
  }

  return buildNewItemResolution(source, {
    matchingStatus:
      source.originMode === ProjectItemOriginMode.PM_EXPECTED
        ? MatchingStatus.INFERRED
        : source.materialCode || source.provisionalCode
          ? MatchingStatus.EXACT
          : MatchingStatus.INFERRED,
    matchRule:
      source.originMode === ProjectItemOriginMode.PM_EXPECTED
        ? "pm_expected_new_item"
        : source.materialCode
          ? "material_code_new_item"
          : source.provisionalCode
            ? "provisional_code_new_item"
            : normalizedLabel
              ? "description_new_item"
              : "component_slot_new_item",
    matchConfidence: source.materialCode || source.provisionalCode ? MatchConfidence.HIGH : MatchConfidence.MEDIUM
  });
}
