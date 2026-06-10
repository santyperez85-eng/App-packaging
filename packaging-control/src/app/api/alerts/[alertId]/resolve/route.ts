import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError } from "@/app/api/_utils";
import { alertsService } from "@/server/services/alerts-service";

const bodySchema = z.object({
  note: z.string().trim().max(500).optional()
});

export async function POST(request: Request, context: { params: Promise<{ alertId: string }> }) {
  try {
    const { alertId } = await context.params;
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const alert = await alertsService.resolveAlert(alertId, {
      manual: true,
      note: body.note ?? null
    });

    return NextResponse.json(alert);
  } catch (error) {
    return handleRouteError(error);
  }
}
