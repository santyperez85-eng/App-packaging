/**
 * Vocabulario de la interfaz.
 *
 * Todo lo que la pantalla le muestra a una persona pasa por aca. La regla es
 * simple: en la UI no se ve ni un identificador tecnico, ni un enum crudo, ni
 * un termino del mundo del desarrollo. Se ve el vocabulario de packaging.
 *
 * Esta centralizado en un solo modulo a proposito. Cuando la traduccion vive
 * dispersa en cada componente, alcanza con que alguien agregue una tabla nueva
 * para que vuelva a aparecer un `WAITING_DOCS` en pantalla.
 */

export type Tone = "success" | "warning" | "danger" | "neutral";

export type Label = { text: string; tone: Tone };

const PROJECT_STATUS: Record<string, Label> = {
  PLANNING: { text: "En definición", tone: "neutral" },
  ACTIVE: { text: "En curso", tone: "neutral" },
  BLOCKED: { text: "Frenado", tone: "danger" },
  READY_TO_CLOSE: { text: "Listo para cerrar", tone: "success" },
  CLOSED: { text: "Cerrado", tone: "success" }
};

const ITEM_STATUS: Record<string, Label> = {
  PENDING: { text: "Sin empezar", tone: "neutral" },
  IN_PROGRESS: { text: "En curso", tone: "neutral" },
  WAITING_CODE: { text: "Espera código", tone: "warning" },
  WAITING_DOCS: { text: "Espera documentos", tone: "warning" },
  BLOCKED: { text: "Frenado", tone: "danger" },
  READY: { text: "Cerrado", tone: "success" }
};

const CRITICALITY: Record<string, Label> = {
  LOW: { text: "Baja", tone: "neutral" },
  MEDIUM: { text: "Media", tone: "neutral" },
  HIGH: { text: "Alta", tone: "warning" },
  CRITICAL: { text: "Crítica", tone: "danger" }
};

const SEVERITY: Record<string, Label> = {
  INFO: { text: "Informativo", tone: "neutral" },
  WARNING: { text: "Atención", tone: "warning" },
  CRITICAL: { text: "Crítico", tone: "danger" }
};

const ALERT_STATUS: Record<string, Label> = {
  OPEN: { text: "Sin resolver", tone: "danger" },
  ACKNOWLEDGED: { text: "Visto", tone: "warning" },
  RESOLVED: { text: "Resuelto", tone: "success" }
};

const REQUEST_STATUS: Record<string, Label> = {
  REQUESTED: { text: "Pedido", tone: "neutral" },
  IN_PROGRESS: { text: "En trámite", tone: "warning" },
  COMPLETED: { text: "Otorgado", tone: "success" },
  CANCELLED: { text: "Anulado", tone: "neutral" }
};

const MATCHING_STATUS: Record<string, Label> = {
  EXACT: { text: "Vinculación segura", tone: "success" },
  INFERRED: { text: "Vinculación deducida", tone: "neutral" },
  AMBIGUOUS: { text: "Más de un candidato", tone: "warning" },
  MANUAL_REVIEW: { text: "Necesita que decidas vos", tone: "warning" }
};

const COMPONENT_SLOT: Record<string, string> = {
  ESTUCHE: "Estuche",
  PROSPECTO: "Prospecto",
  ETIQUETA: "Etiqueta",
  FRASCO: "Frasco",
  BLISTER: "Blíster",
  ALUMINIO: "Aluminio",
  POMO: "Pomo",
  FOLLETO: "Folleto",
  INSERTO: "Inserto",
  PORTA_BLISTER: "Porta blíster",
  CALENDARIO: "Calendario",
  OTRO: "Otro"
};

/** De dónde salió cada dato, dicho como lo nombra el sector. */
const SOURCE: Record<string, string> = {
  pm: "Planilla del PM",
  pm_expected: "Planilla del PM",
  materials_master: "Planilla de materiales",
  bom: "Receta",
  material_request: "Alta de código",
  material_master: "Maestro de materiales",
  sap: "SAP",
  moondesk: "Moondesk",
  moondesk_task: "Moondesk",
  approved_document: "Documentos aprobados",
  manual: "Carga manual"
};

const BUSINESS_UNIT: Record<string, string> = {
  PHARMA: "Farma",
  COSMETIC: "Cosmética"
};

function lookup(table: Record<string, Label>, value: string | null | undefined): Label {
  if (!value) {
    return { text: "Sin dato", tone: "neutral" };
  }

  return table[value] ?? { text: humanize(value), tone: "neutral" };
}

/**
 * Ultimo recurso para un valor que todavia no tiene traduccion: al menos que no
 * se lea como una constante de codigo.
 */
export function humanize(value: string) {
  const spaced = value.replace(/_/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const labels = {
  projectStatus: (value?: string | null) => lookup(PROJECT_STATUS, value),
  itemStatus: (value?: string | null) => lookup(ITEM_STATUS, value),
  criticality: (value?: string | null) => lookup(CRITICALITY, value),
  severity: (value?: string | null) => lookup(SEVERITY, value),
  alertStatus: (value?: string | null) => lookup(ALERT_STATUS, value),
  requestStatus: (value?: string | null) => lookup(REQUEST_STATUS, value),
  matchingStatus: (value?: string | null) => lookup(MATCHING_STATUS, value),
  /**
   * En la historia de un componente, un mismo campo trae a veces el estado de
   * un aviso y a veces cómo se vinculó una evidencia. Se resuelve contra las
   * dos tablas para que no se filtre un `EXACT` crudo a la pantalla.
   */
  eventStatus: (value?: string | null) =>
    value && MATCHING_STATUS[value] ? MATCHING_STATUS[value] : lookup(ALERT_STATUS, value),
  componentSlot: (value?: string | null) => (value ? (COMPONENT_SLOT[value] ?? humanize(value)) : "Sin clasificar"),
  businessUnit: (value?: string | null) => (value ? (BUSINESS_UNIT[value] ?? humanize(value)) : "Sin unidad"),
  source: (value?: string | null) => (value ? (SOURCE[value] ?? humanize(value)) : "Origen desconocido")
};

/**
 * Los codigos de proyecto vienen de la importacion (`PM-DAPABER-10-MG-X-28-COMPRIMIDOS`).
 * Sirven como identificador estable pero no como titulo: en pantalla se muestra
 * el nombre del producto, y el codigo solo donde hace falta rastrear el origen.
 */
export function readableProjectCode(code: string) {
  return code.replace(/^PM-/, "").replace(/-/g, " ");
}

const DATE_FORMAT = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric" });
const SHORT_DATE_FORMAT = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * Una fecha de lanzamiento o de corte es una fecha de calendario, no un
 * instante: se guarda como medianoche UTC. Formatearla en horario local la
 * corre un dia hacia atras en Argentina, asi que estas variantes fuerzan UTC.
 * Para marcas de tiempo reales (cuando se creo un aviso) va el horario local.
 */
const CALENDAR_FORMAT = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC"
});
const SHORT_CALENDAR_FORMAT = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC"
});

function parseDate(value: Date | string) {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) || parsed.getTime() <= 0 ? null : parsed;
}

/** Marcas de tiempo (cuando paso algo), en horario local. */
export function formatDate(value?: Date | string | null, fallback = "Sin fecha") {
  const parsed = value ? parseDate(value) : null;
  return parsed ? DATE_FORMAT.format(parsed) : fallback;
}

export function formatShortDate(value?: Date | string | null, fallback = "—") {
  const parsed = value ? parseDate(value) : null;
  return parsed ? SHORT_DATE_FORMAT.format(parsed) : fallback;
}

/** Fechas de calendario (lanzamiento, corte de SAP), sin corrimiento de zona. */
export function formatCalendarDate(value?: Date | string | null, fallback = "Sin fecha") {
  const parsed = value ? parseDate(value) : null;
  return parsed ? CALENDAR_FORMAT.format(parsed) : fallback;
}

export function formatShortCalendarDate(value?: Date | string | null, fallback = "—") {
  const parsed = value ? parseDate(value) : null;
  return parsed ? SHORT_CALENDAR_FORMAT.format(parsed) : fallback;
}

/**
 * "hace 3 días", "en 2 semanas": mas legible que una fecha suelta al priorizar.
 * Compara en UTC porque se usa sobre fechas de calendario.
 */
export function relativeToToday(value?: Date | string | null) {
  if (!value) return null;
  const parsed = parseDate(value);
  if (!parsed) return null;

  const today = new Date();
  const startOfDay = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const days = Math.round(
    (startOfDay(parsed) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / (24 * 60 * 60 * 1000)
  );

  if (days === 0) return "hoy";
  if (days === 1) return "mañana";
  if (days === -1) return "ayer";

  const magnitude = Math.abs(days);
  const amount =
    magnitude < 14
      ? `${magnitude} días`
      : magnitude < 60
        ? `${Math.round(magnitude / 7)} semanas`
        : `${Math.round(magnitude / 30)} meses`;

  return days > 0 ? `en ${amount}` : `hace ${amount}`;
}

/** "3 componentes" / "1 componente", para no escribir "component(s)" en la UI. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
