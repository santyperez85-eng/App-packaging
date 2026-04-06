import { NextResponse } from "next/server";

import { handleRouteError } from "@/app/api/_utils";
import { prisma } from "@/lib/prisma";

export async function GET(_: Request, context: { params: Promise<{ projectItemId: string }> }) {
  try {
    const { projectItemId } = await context.params;
    const item = await prisma.projectItem.findUnique({
      where: { id: projectItemId },
      include: {
        project: true,
        materialMaster: true,
        bomItem: true,
        materialRequest: true,
        alerts: true,
        technicalChecks: true,
        evidences: true,
        moondeskTasks: {
          include: {
            documents: true,
            reviews: true
          }
        }
      }
    });

    if (!item) {
      throw new Error("Project item not found");
    }

    return NextResponse.json(item);
  } catch (error) {
    return handleRouteError(error);
  }
}
