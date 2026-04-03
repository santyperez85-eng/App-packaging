import { NextRequest, NextResponse } from "next/server";

import { handleRouteError } from "@/app/api/_utils";
import { bomItemsService } from "@/server/services/bom-items-service";
import { bomItemInputSchema } from "@/server/services/schemas";

export async function GET(request: NextRequest) {
  try {
    const projectId = request.nextUrl.searchParams.get("projectId") ?? undefined;
    const data = await bomItemsService.listBomItems({ projectId });

    return NextResponse.json(data);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = bomItemInputSchema.parse(await request.json());
    const data = await bomItemsService.upsertBomItem(payload);

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
