import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError } from "@/app/api/_utils";
import { projectsRepository } from "@/server/repositories/projects-repository";
import { projectsService } from "@/server/services/projects-service";

/**
 * La fecha de lanzamiento es el unico dato que se edita desde la pantalla: no
 * viene de ninguna fuente y es el criterio con el que se prioriza la cartera.
 */
const patchSchema = z.object({
  targetLaunchDate: z.coerce.date().nullable()
});

export async function GET(_: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const data = await projectsService.getProjectDetail(projectId);

    return NextResponse.json(data);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const { targetLaunchDate } = patchSchema.parse(await request.json());
    const project = await projectsRepository.updateLaunchDate(projectId, targetLaunchDate);

    return NextResponse.json({ targetLaunchDate: project.targetLaunchDate });
  } catch (error) {
    return handleRouteError(error);
  }
}
