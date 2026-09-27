/**
 * Cliente de la API de MoonDesk.
 *
 * La API esta organizada por **documento**, no por tarea: cada documento es un
 * arte, un plano, una especificacion o una ficha tecnica, y lleva sus datos como
 * "clasificadores" (Cod. Insumo, Producto, Cod. Plano, Destino...). Eso la hace
 * distinta del reporte Excel, que venia por tarea.
 *
 * Es de solo lectura: la API no expone ninguna operacion de escritura, asi que
 * no hay forma de que la app modifique nada en MoonDesk.
 *
 * Documentacion viva: https://api.moondesk.design/swagger/v1/swagger.json
 */

const DEFAULT_BASE_URL = "https://api.moondesk.design";

/** La busqueda devuelve de a 20 documentos; el tamano lo fija el servidor. */
export const MOONDESK_PAGE_SIZE = 20;

export type MoondeskClassValue = {
  className: string;
  value: string;
  code?: string | null;
};

export type MoondeskVersionPayload = {
  id: string;
  versionNumber: number;
  minorVersionNumber: number;
  fileType: string | null;
  /** "Approved" | "Draft" */
  status: string | null;
  creator: string | null;
  timestampUtc: string | null;
  documentTags: string[] | null;
  files: string[] | null;
  approvedBy: string | null;
  approvedTimestampUtc: string | null;
};

export type MoondeskTaskPayload = {
  taskId: string | null;
  taskNumber: number | null;
  taskName: string | null;
  state: string | null;
  ownerEmail: string | null;
  assignedEmail: string | null;
};

export type MoondeskDocumentPayload = {
  documentId: string | null;
  documentNumber: number;
  documentType: string | null;
  classValueString: string | null;
  classValues: MoondeskClassValue[] | null;
  latestMayorVersionNumber: number | null;
  latestMinorVersionNumber: number | null;
  latestApprovedVersionNumber: number | null;
  pendingTasks: MoondeskTaskPayload[] | null;
  hasPendingTasks: boolean | null;
  lastVersion: MoondeskVersionPayload | null;
  lastMayorVersion: MoondeskVersionPayload | null;
  lastApprovedVersion: MoondeskVersionPayload | null;
  relatedDocuments: MoondeskDocumentPayload[] | null;
  exportName: string | null;
};

export type MoondeskSearchResult = {
  documents: MoondeskDocumentPayload[];
  page: number;
  pageCount: number;
  pageSize: number;
  totalResult: number;
};

export type MoondeskWorkspaceConfiguration = {
  documentTypes: Array<{ name: string; isLibraryType: boolean }>;
  classes: Array<{
    name: string;
    subClasses: unknown[] | null;
    classValues: Array<{ className: string; value: string; code: string | null }> | null;
  }>;
};

export type MoondeskSearchFilter = {
  documentTypes?: string[];
  classValues?: Array<{ className: string; classValue: string }>;
  text?: string;
  /** "Approved" | "Draft"; vacio trae ambos. */
  status?: string;
  minUpdateDate?: string;
  maxUpdateDate?: string;
  page?: number;
};

export class MoondeskApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string
  ) {
    super(message);
    this.name = "MoondeskApiError";
  }
}

export function resolveMoondeskCredentials(overrides?: { baseUrl?: string; apiKey?: string }) {
  const baseUrl = (overrides?.baseUrl ?? process.env.MOONDESK_API_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const apiKey = overrides?.apiKey ?? process.env.MOONDESK_API_TOKEN;

  if (!apiKey) {
    throw new Error(
      "Falta MOONDESK_API_TOKEN. Se carga en packaging-control/.env.local (ese archivo esta fuera de git)."
    );
  }

  return { baseUrl, apiKey };
}

export function createMoondeskClient(overrides?: { baseUrl?: string; apiKey?: string }) {
  const { baseUrl, apiKey } = resolveMoondeskCredentials(overrides);

  async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        "x-api-key": apiKey,
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {})
      },
      body: init?.body ? JSON.stringify(init.body) : undefined
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      // El mensaje nunca incluye la clave: se filtraria a los logs.
      throw new MoondeskApiError(`MoonDesk ${response.status} en ${path}`, response.status, body.slice(0, 500));
    }

    return (await response.json()) as T;
  }

  return {
    baseUrl,

    /** Tipos de documento y clasificadores del workspace de la clave. */
    getConfiguration() {
      return request<MoondeskWorkspaceConfiguration>("/api/v1/Configuration");
    },

    searchDocuments(filter: MoondeskSearchFilter = {}) {
      return request<MoondeskSearchResult>("/api/v1/Document/Search", {
        method: "POST",
        body: { page: 1, ...filter }
      });
    },

    getDocument(documentNumber: number) {
      return request<MoondeskDocumentPayload>(`/api/v1/Document?number=${documentNumber}`);
    },

    getDocumentVersions(documentNumber: number) {
      return request<MoondeskVersionPayload[]>(`/api/v1/Document/DocumentVersions?number=${documentNumber}`);
    },

    /**
     * Recorre todas las paginas de una busqueda, entregando una por una.
     *
     * Es un generador y no una lista completa porque cada pagina tarda ~9
     * segundos: la base entera son ~150 pedidos, mas de veinte minutos. Quien
     * consume va guardando a medida que llegan, asi una falla en la pagina 140
     * no tira todo lo anterior.
     */
    async *streamDocuments(
      filter: Omit<MoondeskSearchFilter, "page"> = {},
      options?: { pauseMs?: number }
    ): AsyncGenerator<{ documents: MoondeskDocumentPayload[]; page: number; pageCount: number; total: number }> {
      const first = await this.searchDocuments({ ...filter, page: 1 });
      yield { documents: first.documents, page: 1, pageCount: first.pageCount, total: first.totalResult };

      for (let page = 2; page <= first.pageCount; page += 1) {
        // Pausa corta: no hay motivo para apurar a un servicio que no es nuestro.
        await new Promise((resolve) => setTimeout(resolve, options?.pauseMs ?? 120));
        const next = await this.searchDocuments({ ...filter, page });
        yield { documents: next.documents, page, pageCount: first.pageCount, total: first.totalResult };
      }
    }
  };
}

export type MoondeskClient = ReturnType<typeof createMoondeskClient>;

/**
 * Los nombres de clasificador vienen con acentos y puntos ("Cod. Insumo",
 * "FT N°"). Se comparan normalizados para no depender de como esten escritos.
 */
function normalizeClassName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const CLASS_ALIASES = {
  materialCode: ["cod insumo", "codigo insumo"],
  productName: ["producto"],
  presentation: ["presentacion"],
  concentration: ["concentracion"],
  format: ["formato"],
  destination: ["destino"],
  drawingCode: ["cod plano", "codigo plano"],
  specificationCode: ["cod especificacion", "codigo especificacion"],
  technicalSheetCode: ["ft n", "ft no", "ft numero"],
  description: ["descripcion"],
  materialTypeLabel: ["tipo de material"]
} as const;

export type MoondeskClassifiers = Record<keyof typeof CLASS_ALIASES, string | null>;

export function extractClassifiers(document: MoondeskDocumentPayload): MoondeskClassifiers {
  const byName = new Map<string, string>();

  for (const entry of document.classValues ?? []) {
    const value = (entry.value ?? "").trim();

    if (entry.className && value) {
      byName.set(normalizeClassName(entry.className), value);
    }
  }

  const result = {} as MoondeskClassifiers;

  for (const [key, aliases] of Object.entries(CLASS_ALIASES) as Array<
    [keyof typeof CLASS_ALIASES, readonly string[]]
  >) {
    result[key] = aliases.map((alias) => byName.get(alias)).find(Boolean) ?? null;
  }

  return result;
}

/**
 * Estado de aprobacion de un documento, con la distincion que el reporte Excel
 * no permitia hacer: existe una version aprobada, pero el diseno puede haber
 * seguido y tener borradores mas nuevos sin aprobar.
 */
export type MoondeskApprovalState = "approved_current" | "approved_outdated" | "never_approved";

export function deriveApprovalState(document: MoondeskDocumentPayload): MoondeskApprovalState {
  const approved = document.latestApprovedVersionNumber ?? 0;
  const latest = document.latestMayorVersionNumber ?? 0;

  // MoonDesk usa **-1** para decir "ninguna version aprobada", no una version
  // numero -1. Son 351 documentos: leerlo como un numero de version los daba
  // por aprobados-pero-desactualizados cuando en realidad nunca se aprobaron.
  // Se corrobora con `lastApprovedVersion`, que en esos casos viene vacio.
  if (approved <= 0 || !document.lastApprovedVersion) {
    return "never_approved";
  }

  return approved < latest ? "approved_outdated" : "approved_current";
}

/**
 * Los codigos MOON deberian ser `MOON` + 5 digitos. Conviven con codigos
 * legitimos del sistema viejo (`PL366`, `EM285`, `120-001-A`) y con tipeos
 * reales (`MOON1043` con 4 digitos, `MOON001059` con 6). Distinguirlos importa
 * porque el cruce contra DOCUMENTOS APROBADOS se hace por este codigo: un
 * tipeo no matchea, y hay que reportarlo en vez de tragarlo.
 */
export function classifyMoonCode(code: string | null): "canonical" | "legacy" | "malformed" | "absent" {
  if (!code) return "absent";

  const trimmed = code.trim();

  if (/^MOON\d{5}$/.test(trimmed)) return "canonical";
  if (/^MOON/i.test(trimmed)) return "malformed";

  return "legacy";
}
