import { NextResponse } from "next/server";

import { handleRouteError } from "@/app/api/_utils";
import { consolidationService } from "@/server/etl/consolidation-service";

export async function POST() {
  try {
    const data = await consolidationService.consolidatePendingImports();

    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
