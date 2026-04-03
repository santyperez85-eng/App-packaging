import { NextResponse } from "next/server";

import { handleRouteError } from "@/app/api/_utils";
import { projectsService } from "@/server/services/projects-service";

export async function GET(_: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const data = await projectsService.getProjectDetail(projectId);

    return NextResponse.json(data);
  } catch (error) {
    return handleRouteError(error);
  }
}
