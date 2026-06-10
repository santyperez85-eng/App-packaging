import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError } from "@/app/api/_utils";
import { moondeskReportService } from "@/server/services/moondesk-report-service";

const bodySchema = z.object({
  workbookPath: z.string().min(1),
  projectCode: z.string().min(1),
  projectToken: z.string().min(1),
  sheetName: z.string().optional(),
  excludeProjectTokens: z.array(z.string()).optional()
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const result = await moondeskReportService.applyReport(body);

    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
