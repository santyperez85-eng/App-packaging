import { PortfolioOverview } from "@/components/portfolio/portfolio-overview";
import { ProductList } from "@/components/portfolio/product-list";
import { SapFreshness } from "@/components/dashboard/sap-freshness";
import { dashboardService } from "@/server/services/dashboard-service";
import { portfolioService } from "@/server/services/portfolio-service";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const portfolio = await portfolioService.getPortfolio();
  const summary = await portfolioService.getSummary(portfolio);
  const sapSnapshot = await dashboardService.getSapFreshness();

  // Lo que pide una decision propia se muestra arriba de todo, fuera del orden
  // por fecha: no depende de que responda otro sector.
  const attention = portfolio.flatMap((product) =>
    product.attention.map((entry) => ({ product, entry }))
  );

  return (
    <div className="stack-xl">
      <PortfolioOverview summary={summary} attention={attention} />

      <ProductList products={portfolio} />

      <SapFreshness snapshot={sapSnapshot ?? null} />
    </div>
  );
}
