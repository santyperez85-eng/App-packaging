import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError } from "@/app/api/_utils";
import { archiveService } from "@/server/services/archive-service";

/**
 * Archivar y reactivar. Un solo endpoint porque es la misma decision en dos
 * sentidos, y el motivo es obligatorio al archivar: sin el, dentro de un mes
 * nadie sabe por que ese componente no esta.
 */
const schema = z.object({
  target: z.enum(["component", "product"]),
  id: z.string().min(1),
  action: z.enum(["archive", "restore"]),
  reason: z.string().optional(),
  by: z.string().optional().nullable()
});

export async function POST(request: Request) {
  try {
    const { target, id, action, reason, by } = schema.parse(await request.json());

    if (action === "restore") {
      const restored =
        target === "component"
          ? await archiveService.restoreComponent(id)
          : await archiveService.restoreProduct(id);

      return NextResponse.json({ ok: true, id: restored.id });
    }

    const archived =
      target === "component"
        ? await archiveService.archiveComponent(id, { reason: reason ?? "", by })
        : await archiveService.archiveProduct(id, { reason: reason ?? "", by });

    return NextResponse.json({ ok: true, id: archived.id });
  } catch (error) {
    return handleRouteError(error);
  }
}
