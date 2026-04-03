import { MaterialType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { handleRouteError } from "@/app/api/_utils";
import { materialsMasterService } from "@/server/services/materials-master-service";
import { materialMasterInputSchema } from "@/server/services/schemas";

export async function GET(request: NextRequest) {
  try {
    const materialType = request.nextUrl.searchParams.get("materialType") ?? undefined;
    const parsedMaterialType =
      materialType && Object.values(MaterialType).includes(materialType as MaterialType)
        ? (materialType as MaterialType)
        : undefined;
    const data = await materialsMasterService.listMaterials({ materialType: parsedMaterialType });

    return NextResponse.json(data);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = materialMasterInputSchema.parse(await request.json());
    const data = await materialsMasterService.upsertMaterial(payload);

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
