import { ComponentSlot } from "@prisma/client";

import { normalizeText } from "@/lib/utils";

/**
 * Determina si un componente lleva impresion y, por lo tanto, si le corresponde
 * un arte que haya que disenar y aprobar.
 *
 * Regla de negocio: el arte aplica unicamente si el componente se imprime. Un
 * envase con etiqueta no se imprime — se pide con un codigo sin version — y la
 * etiqueta se desarrolla aparte con su propio codigo versionado. De ahi que la
 * version del codigo sea la señal: esta atada a la impresion y a la posibilidad
 * de versionarla ante un ajuste.
 *
 * Sin esta distincion el sistema reclama "falta documento aprobado" a tapas,
 * bombas y frascos sin etiqueta, que nunca van a tener arte.
 */

/** Componentes que son impresos por definicion. */
const ALWAYS_PRINTED: ComponentSlot[] = [
  ComponentSlot.ESTUCHE,
  ComponentSlot.PROSPECTO,
  ComponentSlot.ETIQUETA,
  ComponentSlot.FOLLETO,
  ComponentSlot.CALENDARIO,
  ComponentSlot.PORTA_BLISTER,
  ComponentSlot.ALUMINIO
];

/** Componentes que nunca se imprimen. El PVC del blister es transparente. */
const NEVER_PRINTED: ComponentSlot[] = [ComponentSlot.BLISTER];

/** Descripciones que delatan un componente sin impresion, aunque el slot dependa. */
const UNPRINTED_HINTS = ["sin etiq", "sin etiqueta", "s/etiq", "tapa", "bomba", "cuchara", "polietileno", "embolo"];

/** Descripciones que delatan impresion propia. */
const PRINTED_HINTS = ["etiq", "impreso", "serigraf"];

export type PrintRequirement = {
  requiresArt: boolean;
  reason: string;
  /** false cuando la decision se tomo por defecto y no por una señal concreta. */
  confident: boolean;
};

function normalize(value: string | null | undefined) {
  return normalizeText(value ?? "").replace(/[^a-z0-9]+/g, " ").trim();
}

function hasVersion(materialCode: string | null | undefined) {
  const code = (materialCode ?? "").trim();

  return /\/\d+$/.test(code);
}

/**
 * @param materialCode Codigo formal si ya existe. Su version es la señal mas
 * confiable para los componentes cuyo slot no define por si solo si se imprimen.
 */
export function derivePrintRequirement(params: {
  componentSlot: ComponentSlot;
  description?: string | null;
  materialCode?: string | null;
}): PrintRequirement {
  const description = normalize(params.description);

  if (ALWAYS_PRINTED.includes(params.componentSlot)) {
    return { requiresArt: true, reason: `${params.componentSlot} es un componente impreso`, confident: true };
  }

  if (NEVER_PRINTED.includes(params.componentSlot)) {
    return { requiresArt: false, reason: `${params.componentSlot} no lleva impresion`, confident: true };
  }

  // Slots que dependen del caso (frasco, pomo, inserto, otro).
  if (UNPRINTED_HINTS.some((hint) => description.includes(hint))) {
    return { requiresArt: false, reason: "La descripcion indica un componente sin impresion propia", confident: true };
  }

  if (params.materialCode) {
    return hasVersion(params.materialCode)
      ? { requiresArt: true, reason: "El codigo tiene version, que esta atada a la impresion", confident: true }
      : {
          requiresArt: false,
          reason: "El codigo no tiene version: el componente no se imprime y su arte va en otro componente",
          confident: true
        };
  }

  if (PRINTED_HINTS.some((hint) => description.includes(hint))) {
    return { requiresArt: true, reason: "La descripcion indica impresion propia", confident: true };
  }

  // Sin codigo formal todavia no hay señal concluyente. Se asume que requiere
  // arte para no dar por cerrado algo que si lo necesita; queda marcado como no
  // concluyente para poder revisarlo.
  return {
    requiresArt: true,
    reason: "Todavia no hay codigo formal para determinar si lleva impresion; se asume que si",
    confident: false
  };
}
