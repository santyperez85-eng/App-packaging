import { ProjectItemStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { handleRouteError } from "@/app/api/_utils";
import { projectItemsService } from "@/server/services/project-items-service";
import { projectItemInputSchema } from "@/server/services/schemas";

export async function GET(request: NextRequest) {
  try {
    const projectId = request.nextUrl.searchParams.get("projectId") ?? undefined;
    const status = request.nextUrl.searchParams.get("status") ?? undefined;
    const parsedStatus =
      status && Object.values(ProjectItemStatus).includes(status as ProjectItemStatus)
        ? (status as ProjectItemStatus)
        : undefined;
    const data = await projectItemsService.listProjectItems({ projectId, status: parsedStatus });

    return NextResponse.json(data);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = projectItemInputSchema.parse(await request.json());
    const data = await projectItemsService.upsertProjectItem(payload);

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
