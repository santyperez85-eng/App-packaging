import Link from "next/link";

import { StatusBadge } from "@/components/ui/status-badge";
import { labels } from "@/lib/labels";

type ProjectItemsTableProps = {
  items: Array<{
    id: string;
    itemKey: string;
    name: string;
    status: string;
    criticality: string;
    componentSlot?: string | null;
    project?: { code: string; name?: string | null; product?: { name: string } | null } | null;
    materialMaster?: { materialCode: string } | null;
    expectedMaterialCode?: string | null;
    alerts?: Array<{ id: string; severity: string; title: string }>;
  }>;
  showProject?: boolean;
  /**
   * Requisitos de cierre pendientes por componente. Cuando se pasa, la tabla
   * agrega la columna "Qué falta" para no tener que abrir cada ficha. Un
   * componente que no figura en el mapa no tiene faltantes.
   */
  missingByItem?: Record<string, string>;
};

export function ProjectItemsTable({ items, showProject = false, missingByItem }: ProjectItemsTableProps) {
  const showMissingColumn = Boolean(missingByItem);

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {showProject ? <th>Producto</th> : null}
            <th>Componente</th>
            <th>Tipo</th>
            <th>Código de material</th>
            {showMissingColumn ? <th>Qué falta</th> : null}
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              {showProject ? (
                <td>{item.project?.product?.name ?? item.project?.name ?? "Sin producto"}</td>
              ) : null}
              <td>
                <Link className="table-link" href={`/componentes/${item.id}`}>
                  {item.name}
                </Link>
              </td>
              <td>{labels.componentSlot(item.componentSlot)}</td>
              <td>
                {item.materialMaster?.materialCode ?? item.expectedMaterialCode ?? (
                  <span className="muted-text">Sin código</span>
                )}
              </td>
              {showMissingColumn ? (
                <td>{missingByItem?.[item.id] || <span className="muted-text">Nada: está cerrado</span>}</td>
              ) : null}
              <td>
                <StatusBadge label={labels.itemStatus(item.status)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
