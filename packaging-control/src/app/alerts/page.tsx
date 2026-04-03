import { AlertsTable } from "@/components/alerts/alerts-table";
import { SectionCard } from "@/components/ui/section-card";
import { alertsService } from "@/server/services/alerts-service";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const alerts = await alertsService.listAlerts({ status: "OPEN" });

  return (
    <div className="stack-lg">
      <section className="page-intro">
        <span className="eyebrow">Riesgos</span>
        <h1>Alertas</h1>
        <p>Motor base de detección para faltantes, inconsistencias y bloqueos.</p>
      </section>

      <SectionCard
        title="Alertas abiertas"
        description="Generadas desde reglas de BOM, materiales, checks y workflow."
      >
        <AlertsTable alerts={alerts} />
      </SectionCard>
    </div>
  );
}
