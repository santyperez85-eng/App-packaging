import { ExecutivePanel } from "@/components/dashboard/executive-panel";
import { SectionCard } from "@/components/ui/section-card";
import { dashboardService } from "@/server/services/dashboard-service";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const snapshot = await dashboardService.getExecutiveSnapshot();

  return (
    <div className="stack-xl">
      <ExecutivePanel snapshot={snapshot} />

      <div className="grid-two">
        <SectionCard
          title="Primera fase implementada"
          description="Cubre dominio core, staging, consolidación y dashboard mínimo."
        >
          <ul className="flat-list">
            <li>Modelo Prisma con foco en `projects`, `project_items`, `materials_master` y `alerts`.</li>
            <li>Endpoints básicos para dominio core y carga a staging desde Excel o JSON.</li>
            <li>Consolidación inicial que genera project_items y alertas por faltantes o inconsistencias simples.</li>
          </ul>
        </SectionCard>

        <SectionCard
          title="Preparado para siguiente fase"
          description="Se dejó la arquitectura lista para integraciones y reglas avanzadas."
        >
          <ul className="flat-list">
            <li>Stub de cliente Moondesk para workflow vivo de diseño y revisión.</li>
            <li>Stub de cliente SAP para maestro oficial de materiales y compras.</li>
            <li>Espacio separado para motor de reglas regulatorias y evaluación de nuevo código raíz.</li>
          </ul>
        </SectionCard>
      </div>
    </div>
  );
}
