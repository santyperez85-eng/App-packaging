import { NextResponse } from "next/server";

import { handleRouteError } from "@/app/api/_utils";
import { readPmSheetsFromRequest } from "@/server/etl/excel";
import { importService } from "@/server/etl/import-service";

export async function POST(request: Request) {
  try {
    const payload = await readPmSheetsFromRequest(request);
    const data = await importService.importPmRows(payload);

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
