import { Breadcrumb } from "@/components/layout/breadcrumb";
import { ReviewQueue } from "@/components/review/review-queue";
import { reviewService } from "@/server/services/review-service";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const queue = await reviewService.getReviewQueue();

  return (
    <div className="stack-lg">
      <Breadcrumb items={[{ label: "Productos", href: "/" }, { label: "Decisiones" }]} />

      <section className="page-intro">
        <h1>Decisiones</h1>
        <p className="page-intro__summary">
          Lo que la app no puede resolver sola. Las versiones de un mismo código y las presentaciones distintas ya
          no aparecen acá: la versión más nueva reemplaza a las anteriores, y cada presentación es un componente
          aparte. Lo que decidas queda guardado y no se pierde cuando se vuelven a importar los archivos.
        </p>
      </section>

      <ReviewQueue queue={queue} />
    </div>
  );
}
