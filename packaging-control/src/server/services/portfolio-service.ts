import { prisma } from "@/lib/prisma";
import { isMockPreviewEnabled, mockData } from "@/server/mock-data";
import {
  CLOSURE_REQUIREMENT_ORDER,
  CLOSURE_REQUIREMENT_SHORT_LABELS,
  CLOSURE_CHECKLIST_INCLUDE,
  checklistMaterialCode,
  evaluateClosureChecklist,
  type ClosureRequirementKey,
  type ClosureRequirementStatus
} from "@/server/rules/closure-checklist";
import { approvedDocumentsService } from "@/server/services/approved-documents-service";

/**
 * Cartera vista por producto.
 *
 * La unidad de lectura del sector es el producto, no el componente: la pregunta
 * que se hace todos los dias es "como viene DAPABER", y recien despues "que le
 * falta al prospecto de DAPABER". Este servicio arma esa lectura una sola vez y
 * la reusa la pantalla de inicio, la ficha de producto y la busqueda.
 *
 * Todo lo que devuelve esta pensado para mostrarse tal cual: no hay puntajes ni
 * estados internos que la UI tenga que interpretar.
 */

export type ComponentRequirement = {
  key: ClosureRequirementKey;
  label: string;
  shortLabel: string;
  status: ClosureRequirementStatus;
  detail: string;
  source: string;
};

export type PortfolioComponent = {
  id: string;
  itemKey: string;
  name: string;
  slot: string | null;
  materialCode: string | null;
  status: string;
  criticality: string;
  requirements: ComponentRequirement[];
  /** Requisitos que aplican y todavia no estan cumplidos. */
  missing: ClosureRequirementKey[];
  /** Cumplidos pero con una senal que amerita revision (borrado, discontinuado). */
  atRisk: ClosureRequirementKey[];
  applicable: number;
  met: number;
  closed: boolean;
};

export type PortfolioBlocker = {
  key: ClosureRequirementKey;
  shortLabel: string;
  count: number;
};

/**
 * Cuantos componentes del producto cumplen cada requisito.
 *
 * Se expone por requisito en vez de un unico "que falta" porque con la cartera
 * real casi todos los productos deben casi todo: una lista de faltantes por
 * producto termina diciendo "falta todo" en cada fila y no distingue nada. En
 * cambio una columna por requisito deja ver de una pasada cual esta frenado en
 * toda la cartera y cual solo en algunos productos.
 */
export type RequirementCoverage = {
  key: ClosureRequirementKey;
  shortLabel: string;
  met: number;
  applicable: number;
};

export type PortfolioProduct = {
  id: string;
  code: string;
  /** Nombre para mostrar: el del producto, con el del proyecto como respaldo. */
  displayName: string;
  presentation: string | null;
  activeIngredient: string | null;
  status: string;
  launchDate: string | null;
  totalComponents: number;
  closedComponents: number;
  /** Requisitos pendientes agrupados, para leer de un vistazo que traba al producto. */
  blockers: PortfolioBlocker[];
  /** Cobertura de cada requisito sobre los componentes del producto. */
  coverage: RequirementCoverage[];
  /** Senales que piden una decision tuya, no esperar a otro sector. */
  attention: Array<{ componentName: string; requirement: string; detail: string }>;
  components: PortfolioComponent[];
  /** Todos los requisitos cumplidos en todos los componentes. */
  readyToClose: boolean;
  /** Componentes a los que les falta un unico requisito. */
  almostDone: number;
};

function toComponent(
  item: Awaited<ReturnType<typeof loadItems>>[number],
  approvedDocs: Awaited<ReturnType<typeof approvedDocumentsService.getByMaterialCodes>>
): PortfolioComponent {
  const materialCode = checklistMaterialCode(item);
  const checklist = evaluateClosureChecklist(
    item,
    materialCode ? (approvedDocs.get(materialCode.toUpperCase()) ?? null) : null
  );

  const byKey = new Map(checklist.requirements.map((requirement) => [requirement.key, requirement]));
  const requirements = CLOSURE_REQUIREMENT_ORDER.map((key) => {
    const requirement = byKey.get(key)!;

    return {
      key,
      label: requirement.label,
      shortLabel: CLOSURE_REQUIREMENT_SHORT_LABELS[key],
      status: requirement.status,
      detail: requirement.detail,
      source: requirement.source
    };
  });

  return {
    id: item.id,
    itemKey: item.itemKey,
    name: item.name,
    slot: item.componentSlot,
    materialCode,
    status: item.status,
    criticality: item.criticality,
    requirements,
    missing: requirements.filter((requirement) => requirement.status === "missing").map((r) => r.key),
    atRisk: requirements.filter((requirement) => requirement.status === "at_risk").map((r) => r.key),
    applicable: checklist.applicable,
    met: checklist.met,
    closed: checklist.readyToClose
  };
}

function loadItems(projectId?: string) {
  return prisma.projectItem.findMany({
    where: projectId ? { projectId } : undefined,
    include: { ...CLOSURE_CHECKLIST_INCLUDE, project: { include: { product: true } } },
    orderBy: [{ itemKey: "asc" }]
  });
}

/**
 * Sin fecha de lanzamiento no hay urgencia que ordenar. Las plantillas de PM no
 * traen ese dato (se verifico sobre los 44 PM importados: ningun concepto de
 * fecha existe en la plantilla), asi que se carga a mano desde la ficha del
 * producto. Mientras tanto, los productos sin fecha van despues de los que si
 * la tienen, y entre ellos primero el que mas requisitos tiene pendientes.
 */
function comparePriority(left: PortfolioProduct, right: PortfolioProduct) {
  if (left.launchDate && right.launchDate) {
    return left.launchDate.localeCompare(right.launchDate);
  }

  if (left.launchDate) return -1;
  if (right.launchDate) return 1;

  const pending = (product: PortfolioProduct) =>
    product.blockers.reduce((total, blocker) => total + blocker.count, 0);

  return pending(right) - pending(left) || left.displayName.localeCompare(right.displayName);
}

export const portfolioService = {
  async getPortfolio(options?: { projectId?: string }): Promise<PortfolioProduct[]> {
    if (isMockPreviewEnabled()) {
      return mockData.portfolio;
    }

    const items = await loadItems(options?.projectId);
    const approvedDocs = await approvedDocumentsService.getByMaterialCodes(
      items.map((item) => checklistMaterialCode(item)).filter((code): code is string => Boolean(code))
    );

    // Un proyecto sin componentes no aparece si se agrupa desde los items, y no
    // mostrarlo seria esconder justamente el caso mas crudo: un PM del que
    // todavia no se derivo nada.
    const projects = await prisma.project.findMany({
      where: options?.projectId ? { id: options.projectId } : undefined,
      include: { product: true }
    });

    const byProject = new Map<string, PortfolioComponent[]>();

    for (const item of items) {
      const list = byProject.get(item.projectId) ?? [];
      list.push(toComponent(item, approvedDocs));
      byProject.set(item.projectId, list);
    }

    const portfolio = projects.map((project) => {
      const components = byProject.get(project.id) ?? [];
      const blockerCounts = new Map<ClosureRequirementKey, number>();
      const attention: PortfolioProduct["attention"] = [];

      for (const component of components) {
        for (const key of component.missing) {
          blockerCounts.set(key, (blockerCounts.get(key) ?? 0) + 1);
        }

        for (const key of component.atRisk) {
          const requirement = component.requirements.find((entry) => entry.key === key)!;
          attention.push({
            componentName: component.name,
            requirement: requirement.label,
            detail: requirement.detail
          });
        }
      }

      return {
        id: project.id,
        code: project.code,
        displayName: project.product?.name ?? project.name,
        presentation: project.product?.presentation ?? project.presentation,
        activeIngredient: project.activeIngredient,
        status: project.status,
        launchDate: project.targetLaunchDate?.toISOString() ?? null,
        totalComponents: components.length,
        closedComponents: components.filter((component) => component.closed).length,
        blockers: CLOSURE_REQUIREMENT_ORDER.filter((key) => blockerCounts.has(key)).map((key) => ({
          key,
          shortLabel: CLOSURE_REQUIREMENT_SHORT_LABELS[key],
          count: blockerCounts.get(key)!
        })),
        coverage: CLOSURE_REQUIREMENT_ORDER.map((key) => {
          // Un requisito que no aplica a un componente no cuenta ni a favor ni
          // en contra: si no aplica a ninguno, la celda no reporta cobertura.
          const relevant = components.filter((component) =>
            component.requirements.some(
              (requirement) => requirement.key === key && requirement.status !== "not_applicable"
            )
          );

          return {
            key,
            shortLabel: CLOSURE_REQUIREMENT_SHORT_LABELS[key],
            met: relevant.filter((component) =>
              component.requirements.some((requirement) => requirement.key === key && requirement.status === "met")
            ).length,
            applicable: relevant.length
          };
        }),
        attention,
        components,
        readyToClose: components.length > 0 && components.every((component) => component.closed),
        almostDone: components.filter((component) => !component.closed && component.missing.length === 1).length
      } satisfies PortfolioProduct;
    });

    return portfolio.sort(comparePriority);
  },

  /**
   * Un componente con su checklist y el producto al que pertenece. Es lo que
   * necesita la ficha del componente para encabezarse sin volver a consultar.
   */
  async getComponent(projectItemId: string) {
    const item = await prisma.projectItem.findUnique({
      where: { id: projectItemId },
      include: { ...CLOSURE_CHECKLIST_INCLUDE, project: { include: { product: true } } }
    });

    if (!item) {
      return null;
    }

    const materialCode = checklistMaterialCode(item);
    const approvedDocs = await approvedDocumentsService.getByMaterialCodes(materialCode ? [materialCode] : []);

    return {
      component: toComponent(item, approvedDocs),
      product: {
        id: item.project.id,
        displayName: item.project.product?.name ?? item.project.name,
        presentation: item.project.product?.presentation ?? item.project.presentation
      }
    };
  },

  /** Una sola ficha de producto, ya armada con sus componentes y requisitos. */
  async getProduct(projectId: string): Promise<PortfolioProduct | null> {
    const [product] = await this.getPortfolio({ projectId });
    return product ?? null;
  },

  /**
   * Resumen de la cartera en los terminos en que se lee: cuantos productos hay,
   * cuantos estan cerrados, cuantos componentes esperan que otro sector responda
   * y cuantos esperan una decision propia.
   */
  async getSummary(portfolio?: PortfolioProduct[]) {
    const products = portfolio ?? (await this.getPortfolio());
    const components = products.flatMap((product) => product.components);

    return {
      totalProducts: products.length,
      closedProducts: products.filter((product) => product.readyToClose).length,
      totalComponents: components.length,
      closedComponents: components.filter((component) => component.closed).length,
      almostDone: components.filter((component) => !component.closed && component.missing.length === 1).length,
      needsAttention: products.reduce((total, product) => total + product.attention.length, 0),
      /** Cuantos componentes espera cada requisito, en toda la cartera. */
      blockers: CLOSURE_REQUIREMENT_ORDER.map((key) => ({
        key,
        shortLabel: CLOSURE_REQUIREMENT_SHORT_LABELS[key],
        count: components.filter((component) => component.missing.includes(key)).length
      })).filter((blocker) => blocker.count > 0)
    };
  }
};

export type PortfolioSummary = Awaited<ReturnType<typeof portfolioService.getSummary>>;
