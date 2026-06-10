import { notFound } from "next/navigation";

import { ProjectItemLifecycleView } from "@/components/project-items/project-item-lifecycle-view";
import { projectItemLifecycleService } from "@/server/services/project-item-lifecycle-service";

export const dynamic = "force-dynamic";

export default async function ProjectItemLifecyclePage({
  params
}: {
  params: Promise<{ projectItemId: string }>;
}) {
  const { projectItemId } = await params;
  const lifecycle = await projectItemLifecycleService.getProjectItemLifecycle(projectItemId).catch(() => null);

  if (!lifecycle) {
    notFound();
  }

  return <ProjectItemLifecycleView lifecycle={lifecycle} />;
}
