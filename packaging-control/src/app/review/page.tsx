import { ReviewQueue } from "@/components/review/review-queue";
import { reviewService } from "@/server/services/review-service";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const queue = await reviewService.getReviewQueue();

  return (
    <div className="stack-lg">
      <section className="page-intro">
        <span className="eyebrow">Decisiones operativas</span>
        <h1>Revisión manual</h1>
        <p>
          Casos que el matching automático no resuelve solo: confirmaciones de estructura pre-SAP, evidencias
          ambiguas y pedidos de código en competencia. Cada decisión queda trazada y sobrevive a las
          re-consolidaciones.
        </p>
      </section>

      <ReviewQueue queue={queue} />
    </div>
  );
}
