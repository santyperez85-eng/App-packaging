type SapFreshnessProps = {
  snapshot: {
    dataDate: string;
    sourceFileName: string | null;
    materialCount: number;
    currentCount: number;
    discontinuedCount: number;
    erroredCount: number;
    ageInDays: number;
    stale: boolean;
  } | null;
};

function formatDate(value: string) {
  // La fecha del corte es una fecha calendario (viene de un serial de Excel, sin
  // hora): formatearla en horario local la correria un dia hacia atras.
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(value));
}

function ageLabel(ageInDays: number) {
  if (ageInDays === 0) return "de hoy";
  if (ageInDays === 1) return "de ayer";

  return `hace ${ageInDays} días`;
}

/**
 * El maestro de SAP llega por cortes a demanda, no por sincronizacion continua.
 * Mostrar la fecha evita que "no esta en SAP" se lea como un hecho actual cuando
 * en realidad el corte quedo viejo.
 */
export function SapFreshness({ snapshot }: SapFreshnessProps) {
  if (!snapshot) {
    return (
      <div className="sap-freshness sap-freshness--empty">
        <span className="sap-freshness__label">Maestro de SAP</span>
        <span className="sap-freshness__value">Sin corte importado</span>
        <span className="sap-freshness__hint">
          El estado de formalización no se puede evaluar hasta cargar un corte del maestro.
        </span>
      </div>
    );
  }

  return (
    <div className={`sap-freshness${snapshot.stale ? " sap-freshness--stale" : ""}`}>
      <span className="sap-freshness__label">Maestro de SAP</span>
      <span className="sap-freshness__value">
        Datos al {formatDate(snapshot.dataDate)} · {ageLabel(snapshot.ageInDays)}
      </span>
      <span className="sap-freshness__hint">
        {snapshot.materialCount.toLocaleString("es-AR")} materiales ·{" "}
        {snapshot.currentCount.toLocaleString("es-AR")} vigentes ·{" "}
        {snapshot.discontinuedCount.toLocaleString("es-AR")} discontinuados ·{" "}
        {snapshot.erroredCount} con código erróneo
        {snapshot.stale ? " · conviene pedir un corte nuevo" : ""}
      </span>
    </div>
  );
}
