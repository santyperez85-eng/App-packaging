import { NextResponse } from "next/server";

import { handleRouteError } from "@/app/api/_utils";
import { reviewService } from "@/server/services/review-service";

export async function GET() {
  try {
    const data = await reviewService.getReviewQueue();

    return NextResponse.json(data);
  } catch (error) {
    return handleRouteError(error);
  }
}
