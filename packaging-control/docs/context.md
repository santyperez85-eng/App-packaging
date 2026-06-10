# CONTEXTO OPERATIVO

## Descripcion general
Sistema de gestion y control de desarrollo de packaging, enfocado en trazabilidad, consistencia y deteccion temprana de desvios.

Stack:
- Next.js App Router
- Prisma
- PostgreSQL local
- logica server-side en `src/server`

Entidad central:
- `project_items`: representa cada componente de packaging dentro de un proyecto.

Modelo conceptual:
- PM = expectativa
- Altas = evidencia operativa temprana
- BOM/Recetas = evidencia estructural pre-SAP
- Lifecycle por item = read model operativo consolidado
- SAP = formalizacion
- Moondesk = documentacion/aprobacion

## Estado actual validado

### PM
- 1 workbook = 1 caso.
- El selector de hoja PM ya no acepta solo `Producto` + `Presentacion`.
- Una hoja valida debe tener producto, presentacion y estructura PM operativa real.
- Se excluyen hojas tipo `Forecast`, resumen, base, compras, AARR, produccion y auxiliares por nombre y estructura.
- `Caja` no significa `ESTUCHE`; caja es empaque terciario/logistico.
- `ESTUCHE` solo se deriva desde senales explicitas `EST.` o `ESTUCHE`.

### Altas de codigos
- Alta de Mat integrada como evidencia operativa temprana.
- No representa maestro, BOM ni SAP.
- Opera con `matchOnlyExpectedPmItems = true`.
- No crea `project_items` nuevos.
- Si matchea contra item PM, conserva `originMode = PM_EXPECTED`.
- Resuelve `CODE_NOT_REQUESTED` solo cuando hay material request valido.

### BOM/Recetas fase 1
- Implementada como evidencia estructural pre-SAP por componente.
- No representa SAP formal, maestro ni aprobacion documental.
- No toca `MaterialRequest`, `MaterialsMaster`, `SapMaterial` ni `MoondeskTask`.
- Opera con `matchOnlyExpectedPmItems = true`.
- No crea `project_items` nuevos.
- Resuelve `PRE_BOM_MISSING` solo cuando hay cobertura estructural confiable.
- Si hay multiples bloques BOM plausibles para el mismo slot PM, no elige por orden; deja manual review / pending confirmation.
- No resuelve `CODE_NOT_REQUESTED`, `REQUEST_WITHOUT_FORMAL_MATERIAL` ni `APPROVED_DOCUMENT_MISSING`.
- Las evidencias BOM usan `sourceRecordKey` compuesto estable generado por el adapter, no el `componentKey` simplificado.

### Lifecycle operativo por project_item
- Implementado como read model server-side de solo lectura.
- Servicio: `src/server/services/project-item-lifecycle-service.ts`.
- Endpoint: `GET /api/project-items/:projectItemId/lifecycle`.
- No toca schema y no integra SAP, Moondesk, maestro real ni aprobaciones.
- Reconstruye estado operativo desde PM_EXPECTED, material_request, BOM, evidencias, alertas, readiness y status.
- Estructura principal:
  - `milestones`
  - `timeline`
  - `evidences`
  - `alerts`
  - `inconsistencies`
  - `reconstructionGaps`
- Milestones actuales:
  - `expectation`
  - `code_request`
  - `pre_sap_structure`
  - `formal_material`
  - `documentation_approval`
- `reconstructionGaps` explicita huecos de reconstruccion cuando el estado persistido no conserva todo el detalle operativo. Caso clave: Magnesio mantiene la ambiguedad fina de bloques BOM en diagnostics del adapter, no como evidencia final del item.

## Casos reales validados

### PYLOBER PM + Altas
- PM genero 4 items: `ESTUCHE`, `PROSPECTO`, `BLISTER`, `ALUMINIO`.
- Alta de Mat reconcilio 4 material requests contra esos items.
- No hubo duplicados por slot.

### PerPiel Heridas Jabon PM + BOM/Recetas
- PM valida: `Venta Libre-FARMA`.
- PM espera 1 item: `FRASCO`.
- BOM/Recetas matchea bloque `PERPIEL HERIDAS JABON x 250 ml (V)`.
- `FRASCO` queda cubierto por evidencia BOM.
- `BOMBA JABON` queda como subcomponente/evidencia estructural del `FRASCO`.
- `CAJA` queda solo como nota/contexto logistico.
- No se crea `ESTUCHE`.

### PerPiel Heridas Spray PM + BOM/Recetas
- PM valida: `Venta Libre-FARMA`.
- PM detecta producto `Desinfectante`, presentacion `40 ml -`, droga activa `Clorhexidine`.
- PM genera 2 items: `FRASCO` y `PROSPECTO`.
- BOM/Recetas matchea bloque `PERPIEL HERIDAS x 40 ML (V)` mediante alias/contexto manual.
- `FRASCO` recibe evidencia BOM y resuelve `PRE_BOM_MISSING`.
- `PROSPECTO` no recibe evidencia BOM y mantiene `PRE_BOM_MISSING`.
- `BOMBA + TAPA PERPIEL HERIDAS` queda como subcomponente del `FRASCO`.
- `EST.PERPIEL HERIDAS`, `GRANEL`, `TC`, operaciones y O/M no crean items.

### Magnesio en Polvo PM + BOM/Recetas
- PM valida: `Complemento Nutricional`.
- PM genera 1 item: `FRASCO`.
- `Blister = NO`, `Estuche = NO` y `Prospecto/Info paciente = NO` no crean items.
- BOM/Recetas detecta 2 bloques candidatos para `FRASCO`.
- El sistema no elige por orden cuando hay dos bloques plausibles sin desempate confiable.
- No se genera evidencia BOM final para `FRASCO` en este caso ambiguo.
- `PRE_BOM_MISSING` permanece activo.
- `TAPA`, `CUCHARA` y `ETIQ.` quedan como subcomponentes/contexto del `FRASCO`, no como items.
- `CAJA CARTON`, `GRANEL`, `TC`, O/M y operaciones no crean items.

### Lifecycle read model
- Validado con `PYLOBER ESTUCHE`.
  - Muestra expectativa PM y pedido de codigo desde Alta de Mat.
  - `CODE_NOT_REQUESTED` queda resuelto.
  - Persisten faltantes de estructura pre-SAP y documentacion.
- Validado con `PerPiel Spray FRASCO`.
  - Muestra expectativa PM y evidencia BOM confiable.
  - `PRE_BOM_MISSING` queda resuelta para `FRASCO`.
  - La estructura pre-SAP aparece como milestone cubierto/parcial segun evidencias y alertas.
- Validado con `Magnesio FRASCO`.
  - Muestra expectativa PM sin evidencia BOM final por ambiguedad.
  - `PRE_BOM_MISSING` permanece activo.
  - `reconstructionGaps` deja explicito que hubo candidatos BOM ambiguos sin persistir como evidencia final.

## Proximo paso
Disenar una primera vista operativa simple que consuma `GET /api/project-items/:projectItemId/lifecycle` y muestre milestones, timeline, evidencias, alertas, inconsistencias y reconstruction gaps sin mover logica de negocio al frontend.

## Restricciones vigentes
- No integrar SAP todavia.
- No integrar Moondesk todavia.
- No tocar schema para estas fuentes.
- No crear slots canonicos nuevos sin decision explicita.
- No expandir BOM a ciegas sin caso real y criterio de validacion.
