import type { Label, Tone } from "@/lib/labels";
import { humanize } from "@/lib/labels";

/**
 * Un badge de estado. Recibe una etiqueta ya traducida por `@/lib/labels`.
 *
 * Todavia acepta un string suelto porque el reporte interno de validacion
 * (`/qa/functional-validation`) muestra a proposito los valores crudos: es una
 * herramienta de diagnostico, no una pantalla de trabajo. En las pantallas de
 * trabajo hay que pasar una `Label`.
 */
type StatusBadgeProps = {
  label: Label | string;
};

function toneForRawValue(value: string): Tone {
  const normalized = value.toLowerCase();

  if (normalized.includes("critical") || normalized.includes("blocked") || normalized === "open") {
    return "danger";
  }

  if (normalized.includes("warning") || normalized.includes("waiting") || normalized.includes("in_progress")) {
    return "warning";
  }

  if (
    normalized.includes("ready") ||
    normalized.includes("approved") ||
    normalized.includes("resolved") ||
    normalized.includes("closed")
  ) {
    return "success";
  }

  return "neutral";
}

export function StatusBadge({ label }: StatusBadgeProps) {
  const resolved: Label = typeof label === "string" ? { text: humanize(label), tone: toneForRawValue(label) } : label;

  return <span className={`status-badge status-badge--${resolved.tone}`}>{resolved.text}</span>;
}
