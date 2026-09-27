import { ProjectItemExpectedStatus, ProjectItemIdentificationStatus, ProjectItemOriginMode } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { labels } from "@/lib/labels";
import { normalizeText, slugify } from "@/lib/utils";
import { classifyCodeGroup, groupCodesByRoot, type CodeGroup } from "@/server/etl/material-code";
import { resolveProjectTokens } from "@/server/etl/project-token-resolver";

/**
 * Separa en componentes distintos los codigos que caian sobre un mismo slot.
 *
 * La planilla del PM declara "un estuche", pero un producto con cuatro
 * presentaciones tiene cuatro estuches, cada uno con su codigo, su arte, su
 * plano y su especificacion. Colapsarlos en un componente hacia dos danios: la
 * app pedia elegir "cual vale" (pregunta sin sentido: valen todos) y el
 * checklist evaluaba un solo codigo como si representara a los cuatro.
 *
 * Las **versiones** de un mismo codigo no se separan: `SD90/70`, `/71` y `/72`
 * son el mismo prospecto y gana el ultimo. Eso se resuelve solo.
 */

function normalizeForMatch(value: string | null | undefined) {
  return normalizeText(value ?? "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Un codigo provisorio (`EXXX`, `EXXX/70`) es un marcador de "todavia no
 * asignado", no una presentacion distinta: separarlo crearia un componente
 * fantasma que desaparece cuando le dan el codigo real.
 */
function isProvisionalCode(code: string) {
  return /x{2,}/i.test(code);
}

/**
 * A que producto pertenece realmente una descripcion de alta.
 *
 * Se elige el token **mas especifico** que aparezca en el texto. Sin esto,
 * `EST.FLUORDENT JUNIOR` se queda en el proyecto de Fluordent Kids -porque
 * ambos contienen "fluordent"- y la app termina creando el estuche de un
 * producto dentro de otro.
 */
function bestMatchingProject(
  description: string | null,
  specs: Array<{ projectCode: string; token: string }>
) {
  const text = ` ${normalizeForMatch(description)} `;
  let best: { projectCode: string; token: string } | null = null;

  for (const spec of specs) {
    const token = normalizeForMatch(spec.token);

    if (token && text.includes(` ${token} `) && (!best || token.length > normalizeForMatch(best.token).length)) {
      best = spec;
    }
  }

  return best?.projectCode ?? null;
}

/** El codigo de alta esta al final de la clave de evidencia. */
function evidenceRequestCode(sourceRecordKey: string) {
  const segments = sourceRecordKey.split(":");
  return segments.length ? segments[segments.length - 1] : null;
}

/**
 * Nombre legible para el componente separado. Se arma con el tipo de componente
 * y la descripcion del alta, que es donde esta la presentacion
 * (`EST.LIXATROM 15 MG X 30 COMP.(V)` -> "Estuche - LIXATROM 15 MG X 30 COMP.").
 */
function buildItemName(slotLabel: string, description: string | null, code: string) {
  const cleaned = (description ?? "")
    .replace(/^[A-Z]{2,6}\.\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned ? `${slotLabel} - ${cleaned}` : `${slotLabel} - ${code}`;
}

export type SplitPlanEntry = {
  projectCode: string;
  projectItemId: string;
  itemName: string;
  slot: string;
  /** La raiz que se queda en el componente original. */
  keeps: string;
  keepsDescription: string | null;
  /** Las raices que pasan a componentes nuevos. */
  splitsInto: Array<{ rootCode: string; code: string; description: string | null }>;
  /** Codigos que en realidad pertenecen a otro producto: no se separan. */
  belongsElsewhere: Array<{ code: string; description: string | null; projectCode: string }>;
  /** Versiones reemplazadas, informativo: no generan componentes. */
  superseded: Array<{ rootCode: string; current: string; older: string[] }>;
};

async function buildPlan(): Promise<SplitPlanEntry[]> {
  const projects = await prisma.project.findMany({ include: { product: true } });
  const specs = resolveProjectTokens(
    projects.map((project) => ({ code: project.code, productName: project.product?.name ?? project.name }))
  ).map((spec) => ({ projectCode: spec.projectCode, token: spec.token }));

  const items = await prisma.projectItem.findMany({
    where: { evidences: { some: { sourceType: "material_request" } } },
    include: {
      project: true,
      evidences: { where: { sourceType: "material_request" }, orderBy: [{ sourceRecordKey: "asc" }] }
    }
  });

  const plan: SplitPlanEntry[] = [];

  for (const item of items) {
    const codes = item.evidences
      .map((evidence) => ({
        code: evidenceRequestCode(evidence.sourceRecordKey) ?? "",
        description: evidence.rawLabel
      }))
      .filter((entry) => entry.code);

    const groups = groupCodesByRoot(codes);
    const relation = classifyCodeGroup(groups);
    const superseded = groups
      .filter((group) => group.superseded.length)
      .map((group) => ({
        rootCode: group.rootCode,
        current: group.current.code,
        older: group.superseded.map((version) => version.code)
      }));

    if (relation !== "presentations") {
      if (superseded.length) {
        plan.push({
          projectCode: item.project.code,
          projectItemId: item.id,
          itemName: item.name,
          slot: String(item.componentSlot),
          keeps: groups[0]?.current.code ?? "",
          keepsDescription: groups[0] ? descriptionFor(codes, groups[0]) : null,
          splitsInto: [],
          belongsElsewhere: [],
          superseded
        });
      }
      continue;
    }

    // El componente original se queda con la primera raiz; el resto se evalua.
    const [first, ...rest] = [...groups].sort((left, right) => left.rootCode.localeCompare(right.rootCode));
    const splitsInto: SplitPlanEntry["splitsInto"] = [];
    const belongsElsewhere: SplitPlanEntry["belongsElsewhere"] = [];

    for (const group of rest) {
      const description = descriptionFor(codes, group);
      const owner = bestMatchingProject(description, specs);

      if (owner && owner !== item.project.code) {
        belongsElsewhere.push({ code: group.current.code, description, projectCode: owner });
        continue;
      }

      if (isProvisionalCode(group.current.code)) {
        continue;
      }

      splitsInto.push({ rootCode: group.rootCode, code: group.current.code, description });
    }

    if (!splitsInto.length && !belongsElsewhere.length && !superseded.length) {
      continue;
    }

    plan.push({
      projectCode: item.project.code,
      projectItemId: item.id,
      itemName: item.name,
      slot: String(item.componentSlot),
      keeps: first.current.code,
      keepsDescription: descriptionFor(codes, first),
      splitsInto,
      belongsElsewhere,
      superseded
    });
  }

  return plan;
}

function descriptionFor(codes: Array<{ code: string; description: string | null }>, group: CodeGroup) {
  return codes.find((entry) => entry.code === group.current.code)?.description ?? null;
}

export const presentationSplitService = {
  getPlan: buildPlan,

  /**
   * Aplica la separacion. Cada componente nuevo se lleva las evidencias de su
   * raiz, queda apuntando al codigo vigente de esa raiz y hereda del original
   * si lleva impresion (la presentacion no cambia eso: un estuche se imprime
   * sea de 4 o de 30 comprimidos).
   */
  async apply() {
    const plan = await buildPlan();
    let createdItems = 0;
    let movedEvidences = 0;
    let relinked = 0;

    for (const entry of plan) {
      const original = await prisma.projectItem.findUnique({
        where: { id: entry.projectItemId },
        include: { evidences: { where: { sourceType: "material_request" } } }
      });

      if (!original) {
        continue;
      }

      for (const split of entry.splitsInto) {
        const itemKey = `${original.itemKey}-${slugify(split.rootCode).toUpperCase()}`;
        const request = await prisma.materialRequest.findFirst({
          where: { projectId: original.projectId, requestCode: split.code }
        });
        const master = await prisma.materialsMaster.findFirst({ where: { materialCode: split.code } });

        const created = await prisma.projectItem.upsert({
          where: { projectId_itemKey: { projectId: original.projectId, itemKey } },
          update: { name: buildItemName(labels.componentSlot(original.componentSlot), split.description, split.code) },
          create: {
            projectId: original.projectId,
            itemKey,
            name: buildItemName(labels.componentSlot(original.componentSlot), split.description, split.code),
            componentSlot: original.componentSlot,
            applicabilityStatus: original.applicabilityStatus,
            originMode: ProjectItemOriginMode.REQUEST_DETECTED,
            expectedStatus: ProjectItemExpectedStatus.EVIDENCED,
            identificationStatus: ProjectItemIdentificationStatus.IDENTIFIED,
            itemType: original.itemType,
            criticality: original.criticality,
            expectedMaterialCode: split.code,
            materialRequestId: request?.id ?? null,
            materialMasterId: master?.id ?? null,
            requiresApprovedDocument: original.requiresApprovedDocument,
            requiresMaterialCode: original.requiresMaterialCode,
            requiresTechnicalDocs: original.requiresTechnicalDocs
          }
        });

        if (created.createdAt.getTime() === created.updatedAt.getTime()) {
          createdItems += 1;
        }

        // Las evidencias de esta raiz (todas sus versiones) pasan al nuevo.
        const belonging = original.evidences.filter((evidence) => {
          const code = evidenceRequestCode(evidence.sourceRecordKey);
          return code && code.split("/")[0] === split.rootCode;
        });

        for (const evidence of belonging) {
          await prisma.projectItemEvidence.update({
            where: { id: evidence.id },
            data: { projectItemId: created.id }
          });
          movedEvidences += 1;
        }
      }

      // El original queda apuntando al codigo vigente de la raiz que conserva.
      if (entry.keeps) {
        const request = await prisma.materialRequest.findFirst({
          where: { projectId: original.projectId, requestCode: entry.keeps }
        });
        const master = await prisma.materialsMaster.findFirst({ where: { materialCode: entry.keeps } });

        await prisma.projectItem.update({
          where: { id: original.id },
          data: {
            expectedMaterialCode: entry.keeps,
            ...(entry.splitsInto.length
              ? {
                  name: buildItemName(
                    labels.componentSlot(original.componentSlot),
                    entry.keepsDescription,
                    entry.keeps
                  )
                }
              : {}),
            ...(request ? { materialRequestId: request.id } : {}),
            ...(master ? { materialMasterId: master.id } : {})
          }
        });
        relinked += 1;
      }
    }

    return { plan, createdItems, movedEvidences, relinked };
  }
};
