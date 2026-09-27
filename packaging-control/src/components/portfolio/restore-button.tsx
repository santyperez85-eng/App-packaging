"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Reactivar lo archivado. Sin confirmacion: volver a contar no rompe nada. */
export function RestoreButton({ target, id }: { target: "component" | "product"; id: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  return (
    <button
      type="button"
      className="button"
      disabled={saving}
      onClick={async () => {
        setSaving(true);
        await fetch("/api/archive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target, id, action: "restore" })
        });
        setSaving(false);
        router.refresh();
      }}
    >
      {saving ? "Reactivando…" : "Reactivar"}
    </button>
  );
}
