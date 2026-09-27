import { formatDate, relativeToToday } from "@/lib/labels";

type MoondeskFreshnessProps = {
  snapshot: {
    finishedAt: string;
    documentCount: number;
    approvedCurrent: number;
    approvedOutdated: number;
    neverApproved: number;
    ageInDays: number;
    stale: boolean;
  } | null;
};

/**
 * Antiguedad de la ultima sincronizacion con MoonDesk.
 *
 * Mismo motivo que la fecha de corte de SAP: sin saber cuando se trajo el dato,
 * "el arte no esta aprobado" se lee igual que "lo aprobaron ayer y todavia no
 * sincronizamos".
 */
export function MoondeskFreshness({ snapshot }: MoondeskFreshnessProps) {
  if (!snapshot) {
    return (
      <div className="sap-freshness sap-freshness--empty">
        <span className="sap-freshness__label">Moondesk</span>
        <span className="sap-freshness__value">Sin sincronizar</span>
        <span className="sap-freshness__hint">
          El estado de los artes se sigue leyendo de los reportes Excel hasta la primera sincronización.
        </span>
      </div>
    );
  }

  return (
    <div className={`sap-freshness${snapshot.stale ? " sap-freshness--stale" : ""}`}>
      <span className="sap-freshness__label">Moondesk</span>
      <span className="sap-freshness__value">
        Sincronizado el {formatDate(snapshot.finishedAt)} · {relativeToToday(snapshot.finishedAt)}
      </span>
      <span className="sap-freshness__hint">
        {snapshot.documentCount.toLocaleString("es-AR")} documentos ·{" "}
        {snapshot.approvedCurrent.toLocaleString("es-AR")} con la versión vigente aprobada ·{" "}
        {snapshot.approvedOutdated} aprobados con borradores más nuevos ·{" "}
        {snapshot.neverApproved} sin aprobar
        {snapshot.stale ? " · conviene volver a sincronizar" : ""}
      </span>
    </div>
  );
}
