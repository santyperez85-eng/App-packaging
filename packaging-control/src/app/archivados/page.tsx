import { Breadcrumb } from "@/components/layout/breadcrumb";
import { RestoreButton } from "@/components/portfolio/restore-button";
import { SectionCard } from "@/components/ui/section-card";
import { formatShortDate, plural } from "@/lib/labels";
import { archiveService } from "@/server/services/archive-service";

export const dynamic = "force-dynamic";

/**
 * Lo archivado no se pierde: vive aca, con el motivo y la fecha, y se puede
 * reactivar. Sin esta pantalla, archivar seria indistinguible de borrar.
 */
export default async function ArchivedPage() {
  const { products, components } = await archiveService.list();
  const total = products.length + components.length;

  return (
    <div className="stack-lg">
      <Breadcrumb items={[{ label: "Productos", href: "/" }, { label: "Archivados" }]} />

      <section className="page-intro">
        <h1>Archivados</h1>
        <p className="page-intro__summary">
          {total === 0
            ? "No archivaste nada todavía."
            : `${plural(total, "cosa", "cosas")} fuera de los números. Nada se borró: podés reactivar cualquiera y vuelve a contar.`}
        </p>
      </section>

      {products.length ? (
        <SectionCard title="Productos" description="Al reactivar un producto vuelven los componentes que se archivaron con él.">
          <div className="list-stack">
            {products.map((product) => (
              <div key={product.id} className="list-row">
                <div>
                  <div className="list-row__title">{product.name}</div>
                  <div className="list-row__subtitle">
                    {product.reason} · {formatShortDate(product.archivedAt)}
                  </div>
                </div>
                <div className="list-row__meta">
                  <RestoreButton target="product" id={product.id} />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

      {components.length ? (
        <SectionCard title="Componentes" description="Archivados de a uno, sin archivar el producto entero.">
          <div className="list-stack">
            {components.map((component) => (
              <div key={component.id} className="list-row">
                <div>
                  <div className="list-row__title">
                    {component.productName} · {component.name}
                  </div>
                  <div className="list-row__subtitle">
                    {component.reason} · {formatShortDate(component.archivedAt)}
                  </div>
                </div>
                <div className="list-row__meta">
                  <RestoreButton target="component" id={component.id} />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}
