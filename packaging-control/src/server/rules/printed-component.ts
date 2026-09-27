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

/**
 * Descripciones que delatan un componente sin impresion, aunque el slot dependa.
 *
 * "Etiq" entra aca y no entre las señales de impresion: en la descripcion de un
 * envase, `(ETIQ.)` dice que **lleva** una etiqueta, no que este impreso. Lo
 * impreso es la etiqueta, que es otro componente con su propio codigo y su
 * propio arte. Leerlo al reves hacia que el frasco de PerPiel Heridas Jabon
 * -`FCO.PERPIEL HERIDAS JABON x 250 ml (ETIQ.)`- reclamara un arte que nunca
 * va a tener.
 */
const UNPRINTED_HINTS = [
  "sin etiq",
  "sin etiqueta",
  "s/etiq",
  "etiq",
  "etiqueta",
  "tapa",
  "bomba",
  "cuchara",
  "polietileno",
  "embolo"
];

/** Descripciones que delatan impresion propia del envase mismo. */
const PRINTED_HINTS = ["impreso", "serigraf", "impresion directa"];

/**
 * Palabras que describen el envase, no el producto: material, color, medidas,
 * partes y ruido de plantilla. Si despues de sacarlas no queda nada, la
 * descripcion no nombra ningun producto.
 */
const GENERIC_CONTAINER_WORDS = new Set([
  "frasco", "fco", "pomo", "envase", "bidon", "botella", "sachet", "doypack",
  "pet", "pead", "pvc", "pp", "pe", "hdpe", "plastico", "vidrio", "aluminio",
  "verde", "blanco", "negro", "ambar", "transparente", "cristal", "incoloro", "natural", "opaco",
  "tapa", "posadera", "flip", "rosca", "gotero", "valvula", "bomba", "dosificador", "embolo",
  "ml", "cc", "l", "gr", "g", "kg", "mg", "mm", "cm", "x", "con", "sin", "de", "del", "la", "el", "y", "o",
  "etc", "idem", "igual", "mkt", "desarrollo", "operaciones", "produccion", "calidad",
  "especificaciones", "especificacion", "similar", "simil", "nuevo", "nueva"
]);

/**
 * Un componente que se imprime lleva el nombre del producto: el arte **es** esa
 * identificacion. Cuando la descripcion dice solo "FRASCO PET" o "Frasco", el
 * envase se pide sin nada y la identificacion va en otro componente -la
 * etiqueta- que tiene su propio codigo y su propio arte.
 *
 * Es la regla que el sector aplica a ojo: "frasco sin nombre propio" es la
 * senal de que no se imprime.
 */
function namesAProduct(description: string) {
  return description
    .split(" ")
    .filter(Boolean)
    .some((word) => !GENERIC_CONTAINER_WORDS.has(word) && !/^\d/.test(word) && word.length > 1);
}

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

  // Sin codigo formal, la descripcion sigue diciendo algo: si no nombra al
  // producto, el componente se pide sin identificacion y no lleva arte propio.
  if (!namesAProduct(description)) {
    return {
      requiresArt: false,
      reason: "La descripcion no nombra al producto: se pide sin identificacion y su arte va en la etiqueta",
      confident: true
    };
  }

  // Nombra al producto pero todavia no hay codigo que lo confirme. Se asume que
  // requiere arte para no dar por cerrado algo que si lo necesita; queda marcado
  // como no concluyente para poder revisarlo.
  return {
    requiresArt: true,
    reason: "Todavia no hay codigo formal para determinar si lleva impresion; se asume que si",
    confident: false
  };
}
