import { prisma } from "@/lib/prisma";

/**
 * Archivar lo que no corresponde.
 *
 * La app deriva componentes de fuentes que a veces se equivocan o que declaran
 * cosas que nunca se van a hacer: un producto que no se lanza, un componente
 * detectado de mas, un material discontinuado sin reemplazo. Sin una forma de
 * sacarlos, esos casos inflan los numeros para siempre y obligan a leer el
 * tablero descontando de memoria.
 *
 * Se archiva en vez de borrar por tres razones: queda registrado quien lo saco
 * y por que, se puede revertir, y la proxima importacion no lo resucita (la
 * fuente lo sigue declarando, pero la decision de archivarlo es nuestra y
 * sobrevive a la re-consolidacion, igual que las decisiones de vinculacion).
 */

export type ArchiveInput = {
  reason: string;
  by?: string | null;
};

/** Un componente archivado no cuenta en ningun lado. */
export const NOT_ARCHIVED = { archivedAt: null } as const;

export const archiveService = {
  async archiveComponent(projectItemId: string, input: ArchiveInput) {
    const reason = input.reason.trim();

    if (!reason) {
      throw new Error("Hace falta un motivo para archivar: es lo que explica el número a quien lo lea después.");
    }

    return prisma.projectItem.update({
      where: { id: projectItemId },
      data: { archivedAt: new Date(), archivedReason: reason, archivedBy: input.by ?? null }
    });
  },

  async restoreComponent(projectItemId: string) {
    return prisma.projectItem.update({
      where: { id: projectItemId },
      data: { archivedAt: null, archivedReason: null, archivedBy: null }
    });
  },

  /**
   * Archivar un producto archiva tambien sus componentes: si el producto no se
   * lanza, nada de lo que cuelga de el tiene sentido seguir contandolo.
   */
  async archiveProduct(projectId: string, input: ArchiveInput) {
    const reason = input.reason.trim();

    if (!reason) {
      throw new Error("Hace falta un motivo para archivar: es lo que explica el número a quien lo lea después.");
    }

    const archivedAt = new Date();

    await prisma.projectItem.updateMany({
      where: { projectId, archivedAt: null },
      data: { archivedAt, archivedReason: `El producto se archivó: ${reason}`, archivedBy: input.by ?? null }
    });

    return prisma.project.update({
      where: { id: projectId },
      data: { archivedAt, archivedReason: reason, archivedBy: input.by ?? null }
    });
  },

  /**
   * Al reactivar un producto vuelven solo los componentes que se archivaron
   * *con* el, no los que alguien archivo por su cuenta antes.
   */
  async restoreProduct(projectId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });

    if (project?.archivedAt) {
      await prisma.projectItem.updateMany({
        where: { projectId, archivedAt: project.archivedAt },
        data: { archivedAt: null, archivedReason: null, archivedBy: null }
      });
    }

    return prisma.project.update({
      where: { id: projectId },
      data: { archivedAt: null, archivedReason: null, archivedBy: null }
    });
  },

  /** Todo lo archivado, para poder revisarlo y reactivarlo. */
  async list() {
    const [products, components] = await Promise.all([
      prisma.project.findMany({
        where: { archivedAt: { not: null } },
        include: { product: true },
        orderBy: [{ archivedAt: "desc" }]
      }),
      prisma.projectItem.findMany({
        where: { archivedAt: { not: null }, project: { archivedAt: null } },
        include: { project: { include: { product: true } } },
        orderBy: [{ archivedAt: "desc" }]
      })
    ]);

    return {
      products: products.map((project) => ({
        id: project.id,
        name: project.product?.name ?? project.name,
        presentation: project.product?.presentation ?? project.presentation,
        archivedAt: project.archivedAt!.toISOString(),
        reason: project.archivedReason,
        by: project.archivedBy
      })),
      // Los componentes de un producto archivado no se listan aparte: se
      // reactivan con el producto y listarlos duplicaria la misma decision.
      components: components.map((item) => ({
        id: item.id,
        name: item.name,
        productName: item.project.product?.name ?? item.project.name,
        projectId: item.projectId,
        archivedAt: item.archivedAt!.toISOString(),
        reason: item.archivedReason,
        by: item.archivedBy
      }))
    };
  },

  async counts() {
    const [products, components] = await Promise.all([
      prisma.project.count({ where: { archivedAt: { not: null } } }),
      prisma.projectItem.count({ where: { archivedAt: { not: null }, project: { archivedAt: null } } })
    ]);

    return { products, components };
  }
};
