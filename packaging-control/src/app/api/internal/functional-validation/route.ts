import { NextResponse } from "next/server";

import { handleRouteError } from "@/app/api/_utils";
import { getFunctionalValidationDiagnostics } from "@/server/validation/functional-validation-diagnostics-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const report = getFunctionalValidationDiagnostics();

    return NextResponse.json(report);
  } catch (error) {
    return handleRouteError(error);
  }
}
