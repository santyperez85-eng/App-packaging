import { AlertsTable } from "@/components/alerts/alerts-table";
import { SectionCard } from "@/components/ui/section-card";
import { plural } from "@/lib/labels";
import { alertsService } from "@/server/services/alerts-service";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const alerts = await alertsService.listAlerts({ status: "OPEN" });

  return (
    <div className="stack-lg">
      <section className="page-intro">
        <h1>Avisos</h1>
        <p className="page-intro__summary">
          {alerts.length === 0
            ? "No hay ningún aviso sin resolver."
            : `${plural(alerts.length, "aviso")} sin resolver. Son diferencias que aparecieron al cruzar la planilla del PM, las recetas, las altas, SAP y Moondesk.`}
        </p>
      </section>

      {alerts.length ? (
        <SectionCard title="Sin resolver" description="Lo que no coincide entre las fuentes.">
          <AlertsTable alerts={alerts} />
        </SectionCard>
      ) : null}
    </div>
  );
}
