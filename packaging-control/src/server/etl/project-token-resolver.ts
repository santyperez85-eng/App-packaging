import { normalizeText } from "@/lib/utils";

/**
 * Resuelve el token con el que cada proyecto se busca dentro de las fuentes
 * transversales (Alta de Mat, recetas), donde un mismo archivo contiene filas de
 * muchos productos.
 *
 * El problema a evitar es la contaminacion cruzada entre productos con nombres
 * anidados: buscar "VALSARTAN" tambien trae las filas de "VALSARTAN HCT", igual
 * que "PERPIEL HERIDAS" traia las del jabon y la espuma. La solucion es la misma
 * que se valido a mano en ese caso: token + tokens negativos, pero derivados
 * automaticamente comparando los productos entre si.
 */

export type ProjectTokenSpec = {
  projectCode: string;
  productName: string;
  token: string;
  /** Tokens que invalidan una fila aunque contenga el token principal. */
  excludeTokens: string[];
  source: "derived" | "override";
};

/**
 * Casos que el automatismo no puede resolver solo, porque el nombre del producto
 * en la planilla PM no es el que usan las demas fuentes.
 */
const TOKEN_OVERRIDES: Record<string, { token: string; excludeTokens: string[]; reason: string }> = {
  // La planilla del spray dice "Desinfectante" (el tipo, no el nombre). En las
  // demas fuentes es "PERPIEL HERIDAS" a secas; jabon y espuma van calificados.
  "PM-DESINFECTANTE-40-ML": {
    token: "PERPIEL HERIDAS",
    excludeTokens: ["JABON", "ESPUMA", "AQUA", "SERUM"],
    reason: "El PM nombra el producto por su tipo; las otras fuentes usan PERPIEL HERIDAS"
  }
};

function normalizeForMatch(value: string) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * El token util es la parte identificatoria del nombre: se corta en el primer
 * parentesis, porque lo que sigue suele ser composicion o dosis y no aparece en
 * las otras fuentes.
 */
function baseToken(productName: string) {
  const withoutParenthesis = productName.split("(")[0];

  return withoutParenthesis.trim() || productName.trim();
}

/**
 * Diferencia entre dos nombres anidados. Si "VALSARTAN HCT" empieza con
 * "VALSARTAN", devuelve "HCT": el calificador que distingue al hermano y que por
 * lo tanto hay que excluir del producto mas corto.
 */
function trailingQualifier(longer: string, shorter: string) {
  const rest = longer.slice(shorter.length).trim();

  return rest.length >= 2 ? rest : null;
}

export function resolveProjectTokens(
  projects: Array<{ code: string; productName: string | null | undefined }>
): ProjectTokenSpec[] {
  const usable = projects
    .map((project) => ({
      code: project.code,
      productName: (project.productName ?? "").trim(),
      normalized: normalizeForMatch(baseToken(project.productName ?? ""))
    }))
    .filter((project) => project.normalized.length >= 3);

  return usable.map((project) => {
    const override = TOKEN_OVERRIDES[project.code];

    if (override) {
      return {
        projectCode: project.code,
        productName: project.productName,
        token: override.token,
        excludeTokens: override.excludeTokens,
        source: "override" as const
      };
    }

    // Hermanos: otros productos cuyo nombre empieza con el de este. El
    // calificador que los distingue pasa a ser token negativo.
    const excludeTokens = usable
      .filter((other) => other.code !== project.code && other.normalized.startsWith(project.normalized))
      .map((other) => trailingQualifier(other.normalized, project.normalized))
      .filter((qualifier): qualifier is string => Boolean(qualifier));

    return {
      projectCode: project.code,
      productName: project.productName,
      token: baseToken(project.productName),
      excludeTokens: [...new Set(excludeTokens)],
      source: "derived" as const
    };
  });
}
