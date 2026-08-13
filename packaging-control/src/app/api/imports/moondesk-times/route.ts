import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError } from "@/app/api/_utils";
import { moondeskReportService } from "@/server/services/moondesk-report-service";

const bodySchema = z
  .object({
    projectCode: z.string().min(1),
    tasksTimesWorkbookPath: z.string().optional(),
    usersTasksTimesWorkbookPath: z.string().optional()
  })
  .refine((body) => body.tasksTimesWorkbookPath || body.usersTasksTimesWorkbookPath, {
    message: "Provide at least one of tasksTimesWorkbookPath or usersTasksTimesWorkbookPath"
  });

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const result = await moondeskReportService.applyTimesReports(body);

    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
