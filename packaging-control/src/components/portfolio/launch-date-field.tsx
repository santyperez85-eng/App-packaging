"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatCalendarDate, relativeToToday } from "@/lib/labels";

/**
 * Fecha de lanzamiento del producto.
 *
 * Se edita a mano a proposito: la plantilla de PM no tiene ningun campo de
 * fecha (se verifico sobre los 44 PM importados), asi que este es el unico
 * lugar donde el dato existe. Y es el que ordena toda la cartera, por eso esta
 * a la vista en la ficha en vez de escondido en una pantalla de configuracion.
 */
export function LaunchDateField({ projectId, value }: { projectId: string; value: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ? value.slice(0, 10) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(nextValue: string | null) {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLaunchDate: nextValue })
      });

      if (!response.ok) {
        throw new Error("No se pudo guardar la fecha.");
      }

      setEditing(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo guardar la fecha.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="launch-date">
        <span className="launch-date__label">Lanzamiento</span>
        {value ? (
          <span className="launch-date__value">
            {formatCalendarDate(value)} <span className="muted-text">({relativeToToday(value)})</span>
          </span>
        ) : (
          <span className="launch-date__value muted-text">Sin definir</span>
        )}
        <button type="button" className="text-link" onClick={() => setEditing(true)}>
          {value ? "Cambiar" : "Definir"}
        </button>
      </div>
    );
  }

  return (
    <div className="launch-date">
      <span className="launch-date__label">Lanzamiento</span>
      <input
        type="date"
        className="date-input"
        value={draft}
        disabled={saving}
        onChange={(event) => setDraft(event.target.value)}
        aria-label="Fecha de lanzamiento"
      />
      <button type="button" className="button" disabled={saving || !draft} onClick={() => save(draft)}>
        Guardar
      </button>
      {value ? (
        <button
          type="button"
          className="text-link"
          disabled={saving}
          onClick={() => {
            setDraft("");
            void save(null);
          }}
        >
          Quitar
        </button>
      ) : null}
      <button
        type="button"
        className="text-link"
        disabled={saving}
        onClick={() => {
          setDraft(value ? value.slice(0, 10) : "");
          setEditing(false);
          setError(null);
        }}
      >
        Cancelar
      </button>
      {error ? <span className="launch-date__error">{error}</span> : null}
    </div>
  );
}
