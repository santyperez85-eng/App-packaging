import { ProjectItemsTable } from "@/components/project-items/project-items-table";
import { SectionCard } from "@/components/ui/section-card";
import { projectItemsService } from "@/server/services/project-items-service";

export const dynamic = "force-dynamic";

export default async function ProjectItemsPage() {
  const items = await projectItemsService.listProjectItems();

  return (
    <div className="stack-lg">
      <section className="page-intro">
        <span className="eyebrow">Core Entity</span>
        <h1>Project Items</h1>
        <p>Componentes específicos de packaging dentro de cada proyecto.</p>
      </section>

      <SectionCard
        title="Lista de project_items"
        description="Estado operativo, readiness y vinculación con materiales."
      >
        <ProjectItemsTable items={items} showProject />
      </SectionCard>
    </div>
  );
}
