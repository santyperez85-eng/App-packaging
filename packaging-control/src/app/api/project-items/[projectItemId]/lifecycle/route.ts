import { NextResponse } from "next/server";

import { handleRouteError } from "@/app/api/_utils";
import { projectItemLifecycleService } from "@/server/services/project-item-lifecycle-service";

export async function GET(_: Request, context: { params: Promise<{ projectItemId: string }> }) {
  try {
    const { projectItemId } = await context.params;
    const data = await projectItemLifecycleService.getProjectItemLifecycle(projectItemId);

    return NextResponse.json(data);
  } catch (error) {
    return handleRouteError(error);
  }
}
