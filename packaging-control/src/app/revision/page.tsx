import { ReviewQueue } from "@/components/review/review-queue";
import { reviewService } from "@/server/services/review-service";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const queue = await reviewService.getReviewQueue();

  return (
    <div className="stack-lg">
      <section className="page-intro">
        <h1>Decisiones</h1>
        <p className="page-intro__summary">
          Casos que la app no puede resolver sola porque hay más de una lectura posible: un componente que podría
          corresponder a dos códigos, una estructura que hay que confirmar, dos altas compitiendo por el mismo
          material. Lo que decidas queda guardado y no se pierde cuando se vuelven a importar los archivos.
        </p>
      </section>

      <ReviewQueue queue={queue} />
    </div>
  );
}
