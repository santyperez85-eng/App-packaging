import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError } from "@/app/api/_utils";
import { reviewService } from "@/server/services/review-service";

const bodySchema = z.object({
  note: z.string().trim().max(500).optional()
});

export async function POST(request: Request, context: { params: Promise<{ evidenceId: string }> }) {
  try {
    const { evidenceId } = await context.params;
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const evidence = await reviewService.confirmEvidence({
      evidenceId,
      note: body.note ?? null
    });

    return NextResponse.json(evidence);
  } catch (error) {
    return handleRouteError(error);
  }
}
