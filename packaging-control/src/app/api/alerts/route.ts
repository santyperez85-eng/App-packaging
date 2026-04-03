import { AlertStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { handleRouteError } from "@/app/api/_utils";
import { alertsService } from "@/server/services/alerts-service";
import { alertInputSchema } from "@/server/services/schemas";

export async function GET(request: NextRequest) {
  try {
    const projectId = request.nextUrl.searchParams.get("projectId") ?? undefined;
    const projectItemId = request.nextUrl.searchParams.get("projectItemId") ?? undefined;
    const status = request.nextUrl.searchParams.get("status") ?? undefined;
    const parsedStatus =
      status && Object.values(AlertStatus).includes(status as AlertStatus) ? (status as AlertStatus) : undefined;
    const data = await alertsService.listAlerts({
      projectId,
      projectItemId,
      status: parsedStatus
    });

    return NextResponse.json(data);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = alertInputSchema.parse(await request.json());
    const data = await alertsService.createAlert(payload);

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
