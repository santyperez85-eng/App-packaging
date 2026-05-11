import path from "node:path";

import { ComponentSlot } from "@prisma/client";
import * as XLSX from "xlsx";

import { createBatchId, normalizeText, slugify, stringOrNull } from "@/lib/utils";

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

type BuildRecetasBomPayloadParams = {
  workbookPath: string;
  projectCode: string;
  projectToken: string;
  expectedComponentSlots: ComponentSlot[];
  batchId?: string;
  sheetName?: string;
};

type PhysicalRow = {
  rowNumber: number;
  code: string | null;
  description: string | null;
  quantity: string | null;
  unit: string | null;
  scrap: string | null;
  comment: string | null;
};

type RecipeBlock = {
  startRow: number;
  endRow: number;
  rows: PhysicalRow[];
  rootRow: PhysicalRow | null;
  rootDescription: string | null;
};

type BomCandidate = {
  componentSlot: ComponentSlot;
  componentName: string;
  unit: string | null;
  primaryRowNumber: number;
  classificationReason: string;
  block: RecipeBlock;
  subcomponents: Array<{
    rowNumber: number;
    code: string | null;
    description: string;
  }>;
  contextNotes: string[];
  relatedRowNumbers: number[];
  pendingConfirmation: boolean;
};

type AltaReason = {
  rowNumber: number;
  reason: string;
  description?: string | null;
};

type Diagnostics = {
  rowsParsed: number;
  blockCount: number;
  contextMatchedBlocks: number;
  packagingUsefulRows: number;
  normalizedRows: number;
  ignoredRows: number;
  ignoredByReason: Record<string, number>;
  ignoredSamples: AltaReason[];
  candidates: Array<{
    componentSlot: ComponentSlot;
    componentName: string;
    primaryRowNumber: number;
    subcomponentCount: number;
    pendingConfirmation: boolean;
    relatedRowNumbers: number[];
  }>;
};

export type RecetasBomBuildResult = {
  payload: ImportPayload;
  diagnostics: Diagnostics;
};

const DEFAULT_SHEET_NAME = "Recetas";
const MAX_IGNORED_SAMPLES = 12;

function normalizeCell(value: unknown) {
  return stringOrNull(value);
}

function parsePhysicalRow(row: unknown[], rowNumber: number): PhysicalRow {
  return {
    rowNumber,
    code: normalizeCell(row[0]),
    description: normalizeCell(row[1]),
    quantity: normalizeCell(row[2]),
    unit: normalizeCell(row[3]),
    scrap: normalizeCell(row[4]),
    comment: normalizeCell(row[13])
  };
}

function normalizeToken(value: string | null | undefined) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function isTercerosRow(row: PhysicalRow) {
  return normalizeToken(row.code) === "terceros";
}

function isRootRecipeRow(row: PhysicalRow) {
  return normalizeToken(row.scrap) === "scrap";
}

function isCommentOnlyRow(row: PhysicalRow) {
  return !row.description && !row.code && Boolean(row.comment);
}

function isElaboradorRow(row: PhysicalRow) {
  const code = normalizeToken(row.code);

  return code.startsWith("elaborador");
}

function isBulkOrProductProcessRow(row: PhysicalRow) {
  const description = normalizeToken(row.description);
  const code = normalizeToken(row.code);

  return (
    description.includes("granel") ||
    code.startsWith("tx") ||
    code.startsWith("t ") ||
    /^t[0-9a-z]+$/.test(code) ||
    description.startsWith("tc ")
  );
}

function isPackagingSubcomponentRow(row: PhysicalRow) {
  const description = normalizeToken(row.description);

  return description.includes("bomba") || description.includes("tapa");
}

function detectPackagingSlot(row: PhysicalRow) {
  const description = normalizeToken(row.description);
  const tokens = description.split(/\s+/).filter(Boolean);

  if (!description) {
    return null;
  }

  if (description.includes("frasco") || description.includes("fco")) {
    return ComponentSlot.FRASCO;
  }

  if (description.includes("estuche") || tokens.includes("est")) {
    return ComponentSlot.ESTUCHE;
  }

  if (description.includes("etiqueta") || description.includes("etiq")) {
    return ComponentSlot.ETIQUETA;
  }

  if (description.includes("prospecto") || description.includes("prosp")) {
    return ComponentSlot.PROSPECTO;
  }

  if (description.includes("aluminio") || description.includes("alu")) {
    return ComponentSlot.ALUMINIO;
  }

  if (description.includes("blister")) {
    return ComponentSlot.BLISTER;
  }

  return null;
}

function segmentRecipeBlocks(rows: PhysicalRow[]) {
  const startIndexes = rows
    .map((row, index) => (isTercerosRow(row) ? index : -1))
    .filter((index) => index >= 0);

  return startIndexes.map((startIndex, index) => {
    const endIndex = (startIndexes[index + 1] ?? rows.length) - 1;
    const blockRows = rows.slice(startIndex, endIndex + 1);
    const rootRow = blockRows.find((row) => isRootRecipeRow(row)) ?? null;

    return {
      startRow: rows[startIndex]?.rowNumber ?? startIndex + 1,
      endRow: rows[endIndex]?.rowNumber ?? endIndex + 1,
      rows: blockRows,
      rootRow,
      rootDescription: rootRow?.description ?? null
    } satisfies RecipeBlock;
  });
}

function addIgnoredReason(registry: AltaReason[], counts: Record<string, number>, reason: string, row: PhysicalRow) {
  counts[reason] = (counts[reason] ?? 0) + 1;

  if (registry.length < MAX_IGNORED_SAMPLES) {
    registry.push({
      rowNumber: row.rowNumber,
      reason,
      description: row.description
    });
  }
}

function hasPendingConfirmation(notes: string[]) {
  const text = normalizeText(notes.join(" "));

  return (
    text.includes("pend") ||
    text.includes("confirm") ||
    text.includes("sin confirmacion") ||
    text.includes("falta definir") ||
    text.includes("aun sin cargar fase 1 en sap")
  );
}

function formatNote(row: PhysicalRow) {
  const fragments = [row.description, row.comment].filter(Boolean);

  if (!fragments.length) {
    return null;
  }

  return `row ${row.rowNumber}: ${fragments.join(" | ")}`;
}

function buildNormalizedBomRow(params: {
  projectCode: string;
  projectToken: string;
  sourceFileName: string;
  sheetName: string;
  candidate: BomCandidate;
}) {
  const rootKey =
    slugify(params.candidate.block.rootDescription) ||
    slugify(params.candidate.block.rootRow?.code) ||
    `row-${params.candidate.block.startRow}`;
  const componentSourceKey = slugify(params.candidate.componentName) || `row-${params.candidate.primaryRowNumber}`;
  const sourceRecordKey = [
    "recetas",
    slugify(params.sheetName),
    slugify(params.projectToken),
    `root-${rootKey}`,
    params.candidate.componentSlot.toLowerCase(),
    `component-${componentSourceKey}`
  ].join(":");
  const componentKey = `RECETAS-${slugify(params.projectToken)}-${params.candidate.componentSlot}`.toUpperCase();

  return {
    project_code: params.projectCode,
    component_key: componentKey,
    source_record_key: sourceRecordKey,
    component_name: params.candidate.componentName,
    component_type: "BOTTLE",
    quantity: params.candidate.block.rootRow?.quantity ?? null,
    unit: params.candidate.unit,
    is_packaging: true,
    component_slot: params.candidate.componentSlot,
    rawData: {
      sourceRecordKey,
      sourceWorkbook: params.sourceFileName,
      sheetName: params.sheetName,
      sourceNormalization: {
        explicitComponentSlot: params.candidate.componentSlot,
        explicitComponentSlotSourceValue: params.candidate.componentSlot
      },
      recetasBom: {
        sourceAdapter: "recetas_bom_phase1",
        blockType: "PRODUCT_RECIPE",
        contextMatch: "DIRECT_TOKEN",
        evidenceRole: "PRIMARY_COMPONENT_RECIPE",
        matchOnlyExpectedPmItems: true,
        shouldCreateProjectItem: false,
        classificationReason: params.candidate.classificationReason,
        pendingConfirmation: params.candidate.pendingConfirmation,
        blockStartRow: params.candidate.block.startRow,
        blockEndRow: params.candidate.block.endRow,
        rootRow: params.candidate.block.rootRow?.rowNumber ?? null,
        rootCode: params.candidate.block.rootRow?.code ?? null,
        rootDescription: params.candidate.block.rootDescription ?? null,
        primaryRowNumber: params.candidate.primaryRowNumber,
        relatedRowNumbers: params.candidate.relatedRowNumbers,
        subcomponents: params.candidate.subcomponents,
        contextNotes: params.candidate.contextNotes
      }
    }
  } satisfies RawRow;
}

export function buildRecetasBomImportPayload(params: BuildRecetasBomPayloadParams): RecetasBomBuildResult {
  const workbook = XLSX.readFile(params.workbookPath, { cellDates: true });
  const sheetName = params.sheetName ?? DEFAULT_SHEET_NAME;
  const worksheet = workbook.Sheets[sheetName];

  if (!worksheet) {
    throw new Error(`BOM sheet not found: ${sheetName}`);
  }

  const matrixRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: null,
    raw: false,
    blankrows: true
  });
  const physicalRows = matrixRows.map((row, index) => parsePhysicalRow(row, index + 1));
  const blocks = segmentRecipeBlocks(physicalRows);
  const normalizedProjectToken = normalizeToken(params.projectToken);
  const expectedSlots = new Set(params.expectedComponentSlots);
  const ignoredSamples: AltaReason[] = [];
  const ignoredByReason: Record<string, number> = {};
  const candidatesBySlot = new Map<ComponentSlot, BomCandidate[]>();

  let packagingUsefulRows = 0;
  let contextMatchedBlocks = 0;

  for (const block of blocks) {
    const rootDescription = normalizeToken(block.rootDescription);

    if (!rootDescription || !rootDescription.includes(normalizedProjectToken)) {
      for (const row of block.rows) {
        if (row.description || row.comment) {
          addIgnoredReason(ignoredSamples, ignoredByReason, "outside_project_context", row);
        }
      }
      continue;
    }

    contextMatchedBlocks += 1;
    const blockCandidates = new Map<ComponentSlot, BomCandidate>();
    const blockNotes: string[] = [];

    for (const row of block.rows) {
      if (row === block.rootRow) {
        const note = formatNote(row);

        if (note) {
          blockNotes.push(note);
        }

        continue;
      }

      if (isCommentOnlyRow(row) || isElaboradorRow(row)) {
        const note = formatNote(row);

        if (note) {
          blockNotes.push(note);
        }

        continue;
      }

      if (isBulkOrProductProcessRow(row)) {
        addIgnoredReason(ignoredSamples, ignoredByReason, "non_packaging:bulk_or_process", row);

        const note = formatNote(row);

        if (note) {
          blockNotes.push(note);
        }

        continue;
      }

      const componentSlot = detectPackagingSlot(row);

      if (componentSlot) {
        if (!expectedSlots.has(componentSlot)) {
          addIgnoredReason(ignoredSamples, ignoredByReason, "unexpected_slot_not_in_pm_scope", row);

          const note = formatNote(row);

          if (note) {
            blockNotes.push(note);
          }

          continue;
        }

        if (blockCandidates.has(componentSlot)) {
          addIgnoredReason(ignoredSamples, ignoredByReason, "duplicate_slot_candidate_within_block", row);
          continue;
        }

        packagingUsefulRows += 1;
        blockCandidates.set(componentSlot, {
          componentSlot,
          componentName: row.description ?? componentSlot,
          unit: row.unit,
          primaryRowNumber: row.rowNumber,
          classificationReason: "functional_packaging_component_row",
          block,
          subcomponents: [],
          contextNotes: [],
          relatedRowNumbers: [row.rowNumber],
          pendingConfirmation: false
        });

        const note = formatNote(row);

        if (note) {
          blockNotes.push(note);
        }

        continue;
      }

      if (isPackagingSubcomponentRow(row)) {
        const frascoCandidate = blockCandidates.get(ComponentSlot.FRASCO);

        if (frascoCandidate) {
          packagingUsefulRows += 1;
          frascoCandidate.subcomponents.push({
            rowNumber: row.rowNumber,
            code: row.code,
            description: row.description ?? "Subcomponent"
          });
          frascoCandidate.relatedRowNumbers.push(row.rowNumber);
          const note = formatNote(row);

          if (note) {
            blockNotes.push(note);
          }

          continue;
        }

        addIgnoredReason(ignoredSamples, ignoredByReason, "subcomponent_without_packaging_parent", row);
        continue;
      }

      if (row.description || row.comment) {
        addIgnoredReason(ignoredSamples, ignoredByReason, "non_packaging:unclassified_row", row);
        const note = formatNote(row);

        if (note) {
          blockNotes.push(note);
        }
      }
    }

    for (const candidate of blockCandidates.values()) {
      candidate.contextNotes = blockNotes;
      candidate.pendingConfirmation = hasPendingConfirmation(blockNotes);
      const existing = candidatesBySlot.get(candidate.componentSlot) ?? [];

      candidatesBySlot.set(candidate.componentSlot, [...existing, candidate]);
    }
  }

  const normalizedRows: RawRow[] = [];
  const candidateDiagnostics: Diagnostics["candidates"] = [];

  for (const [slot, slotCandidates] of candidatesBySlot.entries()) {
    if (slotCandidates.length > 1) {
      for (const candidate of slotCandidates) {
        addIgnoredReason(
          ignoredSamples,
          ignoredByReason,
          "duplicate_slot_candidate_across_blocks",
          candidate.block.rows.find((row) => row.rowNumber === candidate.primaryRowNumber) ?? candidate.block.rows[0]
        );
      }

      continue;
    }

    const candidate = slotCandidates[0];
    normalizedRows.push(
      buildNormalizedBomRow({
        projectCode: params.projectCode,
        projectToken: params.projectToken,
        sourceFileName: path.basename(params.workbookPath),
        sheetName,
        candidate
      })
    );
    candidateDiagnostics.push({
      componentSlot: slot,
      componentName: candidate.componentName,
      primaryRowNumber: candidate.primaryRowNumber,
      subcomponentCount: candidate.subcomponents.length,
      pendingConfirmation: candidate.pendingConfirmation,
      relatedRowNumbers: candidate.relatedRowNumbers
    });
  }

  return {
    payload: {
      batchId: params.batchId ?? createBatchId("bom-recetas"),
      sourceFileName: path.basename(params.workbookPath),
      sheets: [
        {
          sheetName,
          rows: normalizedRows
        }
      ]
    },
    diagnostics: {
      rowsParsed: physicalRows.length,
      blockCount: blocks.length,
      contextMatchedBlocks,
      packagingUsefulRows,
      normalizedRows: normalizedRows.length,
      ignoredRows: Object.values(ignoredByReason).reduce((total, value) => total + value, 0),
      ignoredByReason,
      ignoredSamples,
      candidates: candidateDiagnostics
    }
  };
}
