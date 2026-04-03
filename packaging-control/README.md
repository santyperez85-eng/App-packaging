# Packaging Control

MVP inicial para control interno de packaging en entornos farmacéuticos y cosméticos.

## Stack

- Next.js App Router
- React
- Prisma
- PostgreSQL
- XLSX para staging de Excel

## Alcance de esta fase

- Modelado relacional inicial con `project_items` como entidad operativa central
- Endpoints básicos para proyectos, items, materiales, pedidos de código, BOM, Moondesk tasks y alertas
- Importación inicial a tablas de staging desde Excel o payload JSON
- Consolidación base de staging a tablas normalizadas
- Dashboard operativo mínimo para seguimiento y riesgos
- Stubs preparados para Moondesk, SAP y un motor de reglas más avanzado

## Supuestos principales

- `project_items` se derivan primero desde BOM packaging; si falta BOM, se pueden crear items provisorios desde pedidos de código
- El match de materiales del MVP se hace por `material_code` o por una clave normalizada simple
- `health_score` y `readiness_score` son scores de 0 a 100
- La lógica regulatoria avanzada y la evaluación de nuevo código raíz quedan preparadas, no completas

## Puesta en marcha

1. Copiar `.env.example` a `.env`
2. Instalar dependencias con `npm install`
3. Generar cliente Prisma con `npm run db:generate`
4. Crear esquema con `npm run db:push`
5. Cargar seed con `npm run db:seed`
6. Levantar la app con `npm run dev`

## Estructura

- `src/app`: UI y route handlers
- `src/server/services`: orquestación de dominio
- `src/server/repositories`: acceso a datos
- `src/server/etl`: importación y consolidación
- `src/server/rules`: cálculo de alertas y scores
- `src/server/integrations`: contratos para Moondesk y SAP
- `prisma`: schema y seed
