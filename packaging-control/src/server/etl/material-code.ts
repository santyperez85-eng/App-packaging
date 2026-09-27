/**
 * Raiz y version de un codigo de material.
 *
 * Los codigos internos son `<RAIZ>/<VERSION>`: `SD90/70`, `SD90/71`, `SD90/72`
 * son tres versiones del mismo prospecto, y la mas nueva reemplaza a las
 * anteriores. SAP no entiende esa division -lee el codigo como un todo-, pero
 * nuestros procedimientos si, y es la diferencia entre "hay que elegir uno" y
 * "ya esta resuelto, gana el ultimo".
 *
 * Distinguir esto importa mas de lo que parece: sin la division, cuatro
 * estuches de cuatro presentaciones distintas y tres versiones del mismo
 * prospecto se ven igual, y la app termina pidiendo que alguien elija cual
 * "vale" cuando la pregunta no tiene sentido en ninguno de los dos casos.
 */

/** Longitud de los codigos migrados del sistema anterior, que no llevan `/version`. */
const LEGACY_CODE_LENGTH = 4;

export type MaterialCodeParts = {
  code: string;
  rootCode: string;
  versionLabel: string | null;
  /** La version como numero, para comparar cual es mas nueva. */
  versionNumber: number | null;
  versionSource: "code" | "legacy_description" | "none";
};

export function parseMaterialCode(code: string, description?: string | null): MaterialCodeParts {
  const trimmed = code.trim();
  const codeMatch = trimmed.match(/^(.*?)\/(\d+)$/);

  if (codeMatch) {
    return {
      code: trimmed,
      rootCode: codeMatch[1],
      versionLabel: codeMatch[2],
      versionNumber: Number(codeMatch[2]),
      versionSource: "code"
    };
  }

  // Los codigos de exactamente 4 caracteres vienen del sistema que migro a SAP,
  // que no dejaba escribir la version en el codigo: quedo en la descripcion.
  if (trimmed.length === LEGACY_CODE_LENGTH && description) {
    const legacyMatch = description.match(/\/(\d{2})\b/);

    if (legacyMatch) {
      return {
        code: trimmed,
        rootCode: trimmed,
        versionLabel: legacyMatch[1],
        versionNumber: Number(legacyMatch[1]),
        versionSource: "legacy_description"
      };
    }
  }

  // Sin version no es necesariamente un error: los componentes que no llevan
  // impresion se piden con un codigo sin version.
  return { code: trimmed, rootCode: trimmed, versionLabel: null, versionNumber: null, versionSource: "none" };
}

export type CodeGroup = {
  rootCode: string;
  /** El codigo vigente de esa raiz: el de version mas alta. */
  current: MaterialCodeParts;
  /** Versiones anteriores del mismo codigo. Reemplazadas, no son una decision. */
  superseded: MaterialCodeParts[];
};

/**
 * Agrupa codigos por raiz y resuelve, dentro de cada raiz, cual es el vigente.
 *
 * Se asume que a mayor numero de version, mas nueva: es como se numeran por
 * procedimiento (65 -> 70 -> 71 -> 72). Un codigo sin version es su propia
 * raiz y no compite con nadie.
 */
export function groupCodesByRoot(
  codes: Array<{ code: string; description?: string | null }>
): CodeGroup[] {
  const byRoot = new Map<string, MaterialCodeParts[]>();

  for (const entry of codes) {
    if (!entry.code?.trim()) {
      continue;
    }

    const parts = parseMaterialCode(entry.code, entry.description);
    const list = byRoot.get(parts.rootCode) ?? [];

    // Un mismo codigo puede llegar por dos caminos; no se duplica.
    if (!list.some((existing) => existing.code === parts.code)) {
      list.push(parts);
    }

    byRoot.set(parts.rootCode, list);
  }

  return [...byRoot.entries()].map(([rootCode, versions]) => {
    const ordered = [...versions].sort((left, right) => (right.versionNumber ?? -1) - (left.versionNumber ?? -1));

    return { rootCode, current: ordered[0], superseded: ordered.slice(1) };
  });
}

/**
 * Como se relacionan varios codigos que cayeron sobre el mismo componente.
 *
 *  - `single`            un solo codigo: nada que resolver.
 *  - `versions`          una raiz con varias versiones: gana la mas nueva.
 *  - `presentations`     varias raices: son componentes distintos (cada
 *                        presentacion lleva su propio estuche), no compiten.
 */
export type CodeRelation = "single" | "versions" | "presentations";

export function classifyCodeGroup(groups: CodeGroup[]): CodeRelation {
  if (groups.length > 1) {
    return "presentations";
  }

  if (groups.length === 1 && groups[0].superseded.length > 0) {
    return "versions";
  }

  return "single";
}
