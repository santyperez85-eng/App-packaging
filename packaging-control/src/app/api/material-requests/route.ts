import { MaterialRequestStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { handleRouteError } from "@/app/api/_utils";
import { materialRequestsService } from "@/server/services/material-requests-service";
import { materialRequestInputSchema } from "@/server/services/schemas";

export async function GET(request: NextRequest) {
  try {
    const projectId = request.nextUrl.searchParams.get("projectId") ?? undefined;
    const requestStatus = request.nextUrl.searchParams.get("requestStatus") ?? undefined;
    const parsedRequestStatus =
      requestStatus && Object.values(MaterialRequestStatus).includes(requestStatus as MaterialRequestStatus)
        ? (requestStatus as MaterialRequestStatus)
        : undefined;
    const data = await materialRequestsService.listMaterialRequests({
      projectId,
      requestStatus: parsedRequestStatus
    });

    return NextResponse.json(data);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = materialRequestInputSchema.parse(await request.json());
    const data = await materialRequestsService.upsertMaterialRequest(payload);

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
