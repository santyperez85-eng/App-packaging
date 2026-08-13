import { ExecutivePanel } from "@/components/dashboard/executive-panel";
import { PipelinePanel } from "@/components/dashboard/pipeline-panel";
import { dashboardService } from "@/server/services/dashboard-service";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const snapshot = await dashboardService.getExecutiveSnapshot();

  return (
    <div className="stack-xl">
      <ExecutivePanel snapshot={snapshot} />

      <PipelinePanel pipeline={snapshot.pipeline} />
    </div>
  );
}
