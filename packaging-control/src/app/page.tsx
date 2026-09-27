import { MoondeskFreshness } from "@/components/dashboard/moondesk-freshness";
import { SapFreshness } from "@/components/dashboard/sap-freshness";
import { PortfolioAttention } from "@/components/portfolio/portfolio-overview";
import { ProductList } from "@/components/portfolio/product-list";
import { dashboardService } from "@/server/services/dashboard-service";
import { moondeskApiService } from "@/server/services/moondesk-api-service";
import { portfolioService } from "@/server/services/portfolio-service";

export const dynamic = "force-dynamic";

/**
 * El inicio.
 *
 * Arranca por lo que necesita una decision propia y sigue por la lista de
 * productos, que es donde se ve el estado de cada uno y se puede abrir sin
 * cambiar de pantalla. No hay resumen general ni numeros agregados: esa foto no
 * dispara ninguna accion y quedo en Componentes, para consultarla cuando haga
 * falta.
 */
export default async function HomePage() {
  const portfolio = await portfolioService.getPortfolio();
  const sapSnapshot = await dashboardService.getSapFreshness();
  const moondeskSnapshot = await moondeskApiService.getFreshness();

  const attention = portfolio.flatMap((product) => product.attention.map((entry) => ({ product, entry })));

  return (
    <div className="stack-xl">
      <PortfolioAttention attention={attention} />

      <ProductList products={portfolio} />

      <SapFreshness snapshot={sapSnapshot ?? null} />

      <MoondeskFreshness snapshot={moondeskSnapshot} />
    </div>
  );
}
