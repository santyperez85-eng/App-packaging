"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Archivar desde la pantalla, sin irse a ningun lado.
 *
 * Pide un motivo porque es lo unico que explica el numero despues: dentro de un
 * mes, "archivado" sin motivo es indistinguible de un error. Ofrece motivos
 * frecuentes para que en el caso tipico sea un solo clic.
 */
const REASONS = [
  "El producto no se lanza",
  "Discontinuado, sin reemplazo",
  "Detectado de más: no corresponde",
  "Duplicado de otro componente"
];

export function ArchiveButton({
  target,
  id,
  label
}: {
  target: "component" | "product";
  id: string;
  label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function archive(finalReason: string) {
    if (!finalReason.trim()) {
      setError("Escribí un motivo.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, id, action: "archive", reason: finalReason })
      });

      if (!response.ok) {
        throw new Error((await response.json().catch(() => ({}))).error ?? "No se pudo archivar.");
      }

      setOpen(false);
      router.refresh();
      if (target === "product") router.push("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo archivar.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="text-link" onClick={() => setOpen(true)}>
        Archivar {label}
      </button>
    );
  }

  return (
    <div className="archive-box">
      <div className="archive-box__title">¿Por qué archivás {label}?</div>
      <p className="archive-box__hint">
        Deja de contar en todos los números y no vuelve al reimportar. Se puede reactivar cuando quieras.
      </p>

      <div className="chip-row">
        {REASONS.map((preset) => (
          <button
            key={preset}
            type="button"
            className="chip chip--action"
            disabled={saving}
            onClick={() => archive(preset)}
          >
            {preset}
          </button>
        ))}
      </div>

      <div className="archive-box__custom">
        <input
          type="text"
          className="search-input"
          placeholder="…u otro motivo"
          value={reason}
          disabled={saving}
          onChange={(event) => setReason(event.target.value)}
        />
        <button type="button" className="button" disabled={saving || !reason.trim()} onClick={() => archive(reason)}>
          Archivar
        </button>
        <button type="button" className="text-link" disabled={saving} onClick={() => setOpen(false)}>
          Cancelar
        </button>
      </div>

      {error ? <div className="launch-date__error">{error}</div> : null}
    </div>
  );
}
