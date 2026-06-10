import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError } from "@/app/api/_utils";
import { reviewService } from "@/server/services/review-service";

const bodySchema = z.object({
  materialRequestId: z.string().min(1),
  note: z.string().trim().max(500).optional()
});

export async function POST(request: Request, context: { params: Promise<{ projectItemId: string }> }) {
  try {
    const { projectItemId } = await context.params;
    const body = bodySchema.parse(await request.json());
    const item = await reviewService.linkMaterialRequest({
      projectItemId,
      materialRequestId: body.materialRequestId,
      note: body.note ?? null
    });

    return NextResponse.json(item);
  } catch (error) {
    return handleRouteError(error);
  }
}
