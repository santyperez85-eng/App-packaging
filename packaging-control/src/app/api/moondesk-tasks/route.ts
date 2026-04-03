import { MoondeskTaskStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { handleRouteError } from "@/app/api/_utils";
import { moondeskTasksService } from "@/server/services/moondesk-tasks-service";
import { moondeskTaskInputSchema } from "@/server/services/schemas";

export async function GET(request: NextRequest) {
  try {
    const projectItemId = request.nextUrl.searchParams.get("projectItemId") ?? undefined;
    const taskStatus = request.nextUrl.searchParams.get("taskStatus") ?? undefined;
    const parsedTaskStatus =
      taskStatus && Object.values(MoondeskTaskStatus).includes(taskStatus as MoondeskTaskStatus)
        ? (taskStatus as MoondeskTaskStatus)
        : undefined;
    const data = await moondeskTasksService.listMoondeskTasks({
      projectItemId,
      taskStatus: parsedTaskStatus
    });

    return NextResponse.json(data);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = moondeskTaskInputSchema.parse(await request.json());
    const data = await moondeskTasksService.upsertMoondeskTask(payload);

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
