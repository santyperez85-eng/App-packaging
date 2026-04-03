import { ProjectsTable } from "@/components/projects/projects-table";
import { SectionCard } from "@/components/ui/section-card";
import { projectsService } from "@/server/services/projects-service";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const projects = await projectsService.listProjects();

  return (
    <div className="stack-lg">
      <section className="page-intro">
        <span className="eyebrow">Operación</span>
        <h1>Proyectos</h1>
        <p>Seguimiento consolidado de salud, fechas e items críticos por proyecto.</p>
      </section>

      <SectionCard
        title="Lista de proyectos"
        description="Vista base del PM y operaciones para priorizar riesgos de packaging."
      >
        <ProjectsTable projects={projects} />
      </SectionCard>
    </div>
  );
}
