import { BusinessUnit, ProjectStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { handleRouteError } from "@/app/api/_utils";
import { projectsService } from "@/server/services/projects-service";
import { projectInputSchema } from "@/server/services/schemas";

export async function GET(request: NextRequest) {
  try {
    const status = request.nextUrl.searchParams.get("status") ?? undefined;
    const businessUnit = request.nextUrl.searchParams.get("businessUnit") ?? undefined;
    const parsedStatus =
      status && Object.values(ProjectStatus).includes(status as ProjectStatus) ? (status as ProjectStatus) : undefined;
    const parsedBusinessUnit =
      businessUnit && Object.values(BusinessUnit).includes(businessUnit as BusinessUnit)
        ? (businessUnit as BusinessUnit)
        : undefined;
    const data = await projectsService.listProjects({
      status: parsedStatus,
      businessUnit: parsedBusinessUnit
    });

    return NextResponse.json(data);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = projectInputSchema.parse(await request.json());
    const data = await projectsService.upsertProject(payload);

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
