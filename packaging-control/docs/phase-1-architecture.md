# Phase 1 Architecture

## 1. Resumen técnico

Se eligió `Next.js + Prisma + PostgreSQL` porque permite resolver UI, APIs internas y SSR con un stack único, simple de operar y suficientemente extensible para un entorno regulado. La lógica de negocio queda del lado servidor en `src/server`, separada de la UI y del staging de importación.

Supuestos explícitos del MVP:

- `project_items` se generan principalmente desde BOM packaging.
- Si no existe BOM pero sí pedido de código, se crea un `project_item` provisorio.
- La consolidación inicial matchea materiales por `material_code` o por descripción simple.
- Los scores `health_score` y `readiness_score` se calculan de 0 a 100.
- Las reglas regulatorias avanzadas, POS652 y decisión fina entre salto de versión vs nuevo código raíz quedan preparadas, no cerradas.

## 2. Estructura de proyecto

```text
packaging-control/
  prisma/
    schema.prisma
    seed.ts
  src/
    app/
      api/
      alerts/
      project-items/
      projects/
      globals.css
      layout.tsx
      page.tsx
    components/
      alerts/
      dashboard/
      layout/
      project-items/
      projects/
      ui/
    lib/
      prisma.ts
      utils.ts
    server/
      etl/
      integrations/
      repositories/
      rules/
      services/
  docs/
    phase-1-architecture.md
```

## 3. Esquema Prisma inicial

Core MVP:

- `products`
- `projects`
- `project_items`
- `bom_items`
- `material_requests`
- `materials_master`
- `moondesk_tasks`
- `technical_checks`
- `alerts`
- `users`

Preparadas para fase siguiente:

- `sap_materials`
- `moondesk_versions`
- `moondesk_reviews`
- `moondesk_documents`
- `approvals`
- `issues`
- `pos652_rule_evaluations`
- `material_change_history`
- `import_moondesk_raw`
- `import_sap_raw`

Staging MVP:

- `import_pm_rows`
- `import_material_master_rows`
- `import_bom_rows`
- `import_material_request_rows`

## 4. Servicios y endpoints

Servicios base:

- `projectsService`
- `projectItemsService`
- `materialsMasterService`
- `materialRequestsService`
- `bomItemsService`
- `moondeskTasksService`
- `alertsService`
- `dashboardService`

APIs:

- `GET/POST /api/projects`
- `GET /api/projects/[projectId]`
- `GET/POST /api/project-items`
- `GET /api/project-items/[projectItemId]`
- `GET/POST /api/materials-master`
- `GET/POST /api/material-requests`
- `GET/POST /api/bom-items`
- `GET/POST /api/moondesk-tasks`
- `GET/POST /api/alerts`
- `POST /api/imports/pm`
- `POST /api/imports/material-master`
- `POST /api/imports/bom`
- `POST /api/imports/material-requests`
- `POST /api/consolidation`

## 5. ETL / importación

Flujo inicial:

1. Cargar Excel o JSON hacia tablas de staging.
2. Normalizar cabeceras y mapear columnas frecuentes por alias.
3. Upsert de `materials_master`.
4. Upsert de `products` y `projects`.
5. Upsert de `material_requests`.
6. Upsert de `bom_items`.
7. Generación y refresh de `project_items`.
8. Recalcular alertas y scores.

## 6. Reglas básicas del MVP

- Si BOM packaging no tiene material asociado, se crea alerta crítica.
- Si un material existe pero le faltan plano, especificación o ficha técnica, se crea alerta.
- Si diseño está completado y no existe revisión, se crea alerta.
- Si la revisión está vencida, se crea alerta crítica.
- Si faltan checks bloqueantes, el item queda bloqueado.
- Si falta documento aprobado y aplica, el item no queda listo.
- Si un proyecto tiene `project_items` críticos no listos, no debe cerrarse.

## 7. UI mínima

- `/`: vista ejecutiva con KPIs, proyectos en riesgo y alertas recientes.
- `/projects`: lista de proyectos.
- `/projects/[projectId]`: detalle con items, BOM, pedidos de código y alertas.
- `/project-items`: lista transversal de items operativos.
- `/alerts`: lista de alertas abiertas.

## 8. Prioridades siguientes

P0:

- Instalar dependencias, generar cliente Prisma y validar build.
- Ejecutar `db push` y seed.
- Probar importaciones reales con 1 archivo por fuente.

P1:

- Integrar Moondesk API real.
- Resolver autenticación interna simple.
- Incorporar edición básica de estados y resolución de alertas desde UI.

P2:

- Integrar SAP.
- Implementar reglas avanzadas de versionado y nuevo código raíz.
- Añadir approvals, issues y timeline consolidado por item.
