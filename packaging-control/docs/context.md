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
- `ALUMINIO` no se deriva de descripciones de sellado por induccion: el disco/sello de induccion integra el cierre (tapa) y no pide codigo propio. Caso validado: Creatina.
- El `projectCode` se deriva de info interna (`producto` + `presentacion` de la hoja PM), no del nombre del archivo. Fallback al filename solo si la hoja no trae producto.
- Dato pendiente de origen: la planilla del PerPiel Heridas Spray tiene `Producto = Desinfectante` (el tipo, no el nombre); corregir la celda en la planilla para que el codigo interno quede bien.

### Altas de codigos
- Alta de Mat integrada como evidencia operativa temprana.
- No representa maestro, BOM ni SAP.
- Opera con `matchOnlyExpectedPmItems = true`.
- No crea `project_items` nuevos.
- Si matchea contra item PM, conserva `originMode = PM_EXPECTED`.
- Resuelve `CODE_NOT_REQUESTED` solo cuando hay material request valido.
- Soporta `excludeProjectTokens` (tokens negativos): una fila que matchea el token del proyecto pero contiene un token negativo queda fuera del contexto y corta el arrastre.
- Semantica de nombres PERPIEL HERIDAS confirmada por negocio: `PERPIEL HERIDAS` a secas es el Spray x 40 ml; Jabon y Espuma siempre llevan nombre calificado. El Spray usa token `PERPIEL HERIDAS` con exclusiones `JABON` y `ESPUMA`.

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

### Ciclo completo PM + Altas + BOM (validate:full-cycle)
- Validado con 4 productos reales contra `Control de Vistas materiales dado de alta.xlsx` y `Estructura para carga de recetas.xlsx`.
- Creatina (`PM-CREATINA-300GR`): 1 item `FRASCO` con evidencia BOM (bloque `BERNABIO CREATINA X 300 GR`); tapa, cuchara y etiqueta no crean items; el aluminio de induccion no crea item.
- PerPiel Heridas Jabon (`PM-PERPIEL-HERIDAS-JABON-250-ML`): `FRASCO` con las 3 fuentes (PM + alta `EXXX/70` + BOM); `CODE_NOT_REQUESTED` y `PRE_BOM_MISSING` resueltos.
- PerPiel Heridas Spray (`PM-DESINFECTANTE-40-ML`): altas capturadas con token `PERPIEL HERIDAS` + exclusiones (4 candidatos FRASCO, 10 filas hermanas excluidas); `code_request` partial; PROSPECTO sigue sin evidencia.
- Magnesio (`PM-MAGNESIO-EN-POLVO-150GR`): alta `ED28/70` matcheada; ambiguedad BOM de 2 bloques preservada (`PRE_BOM_MISSING` activo).
- Resuelto: filas `TC.` (tecnica de control) no son packaging y quedan excluidas de la clasificacion (confirmado por negocio).

## Vista de lifecycle
- Implementada en `/project-items/:id` consumiendo el read model server-side; sin logica de negocio en frontend.
- Los item keys de la tabla de Project Items linkean a la vista.

## Revision manual
- Implementada en `/review` con tres colas: pedidos de codigo en competencia (varios material_request evidencian el mismo item), confirmaciones `PRE_BOM_PENDING_CONFIRMATION`, y evidencias `AMBIGUOUS`/`MANUAL_REVIEW`.
- Las decisiones manuales son durables ante re-importacion y re-consolidacion:
  - Vinculo canonico de pedido de codigo: `materialRequestLockedAt` + `manualLinkNote` en `project_items`; la consolidacion no pisa el vinculo mientras este lockeado.
  - Alerta resuelta a mano: `manuallyResolved` + `resolutionNote`; la regla no la reabre mientras la condicion siga igual. Si la condicion sana, la marca se limpia y un re-disparo futuro reabre.
  - Evidencia confirmada: `manualMatchStatus` (+nota +fecha) convive con el `matchStatus` calculado; los read models usan el efectivo (manual ?? calculado).
- Validado con el caso real del Spray: 3 altas competian por el FRASCO, se eligio `EXXX/70` y el vinculo sobrevivio a una re-corrida completa del ciclo.

## Moondesk (via reporte Excel, validate:moondesk)
- La API de Moondesk esta en desarrollo; confirmado por negocio que tomara la info de los reportes Excel que se consultan hoy. El adaptador parsea el "Reporte de tareas" (archivo Tasks).
- Vinculo conservador: por `componentSlot` dentro del proyecto (mapeando Tipo de Documento / Tipo de material a slot), solo a items esperados por el PM. No crea items. El `Cod. Insumo` queda como dato de evidencia.
- Estado de aprobacion derivado: `Revisado`/`Hecho` + `Aprobado` con valor => APPROVED; `En Revision` o `Pendiente` con valor => IN_REVIEW; `Cambio Solicitado` con valor => CHANGES_REQUESTED.
- Crea `MoondeskTask` (REVIEW_REQUEST) + `MoondeskDocument` + evidencia `sourceType=moondesk`. El rules engine ya lee moondeskTasks, asi que el milestone `documentation_approval` se resuelve solo (ready cuando hay doc aprobado).
- `externalTaskId` / `externalDocumentId` estables => reimportar el reporte es idempotente (no duplica). Migracion a API futura: se reemplaza la fuente, el servicio de aplicacion (`moondesk-report-service`) se mantiene.
- Servicio: `src/server/services/moondesk-report-service.ts`. Adapter: `src/server/etl/moondesk-tasks-report.ts`. Endpoint: `POST /api/imports/moondesk`.
- Validado con PYLOBER: 3 docs aprobados (Estuche `SE09/70`, Prospecto `SE10/70`, Aluminio `ED01/10`) => esos slots quedan `documentation_approval=ready` sin `APPROVED_DOCUMENT_MISSING`; el BLISTER (sin doc Moondesk) queda `missing`.
- El milestone `documentation_approval` del lifecycle dejo de estar hardcodeado en `not_integrated`.

## Moondesk enriquecimiento (reportes Times, validate:moondesk-times)
- Segundo y tercer reporte integrados como enriquecimiento de las MoondeskTask ya creadas (vinculo por `sourceTaskNumber` = Numero de Tarea Moondesk). No vinculan items por si mismos.
- `Tasks_Times` => metricas de proceso por tarea: subtareas, reprocesos y dias por fase (Diseno/Revision/Cierre, sumando la matriz por usuario). Se guardan en campos nuevos de `MoondeskTask` (reprocessCount, subtaskCount, designDays, reviewDays, closeDays).
- `Users_Tasks_Times` => trazabilidad: los pasos con Rol=Revisor se materializan como `MoondeskReview` (reviewer, decision, dias habiles, inicio/fin). `sourceStepKey` estable => reimportar es idempotente.
- El read model del lifecycle expone `documentation`: tareas, reviews ordenadas y metricas agregadas. La vista `/project-items/:id` muestra la seccion "Documentacion y aprobacion (Moondesk)".
- Adapter: `src/server/etl/moondesk-times-report.ts`. Servicio: `moondeskReportService.applyTimesReports`. Endpoint: `POST /api/imports/moondesk-times`.
- Validado con PYLOBER: tarea 254 (Estuche) => 2 revisiones de SFIGUEROA (17 y 11 dias), diseno 10 / revision 17 / cierre 3, subtareas 3. Idempotente (6 reviews estables).

## Dashboard ejecutivo
- La home suma el "Pipeline operativo": cobertura agregada de los 5 hitos sobre todos los componentes, con barra segmentada (cubierto / parcial / faltante) y conteos.
- La cobertura se calcula solo sobre los componentes a los que el hito aplica. Si no aplica a ninguno (ej. material formal mientras SAP esta fuera de fase) muestra `n/a`, no 0%: un 0% seria enganoso.
- Tabla "Componentes trabados": ordenada por readiness ascendente, indica el primer hito faltante en orden operativo (donde esta trabado cada componente) y linkea al lifecycle.
- `dashboard-service.getPipelineSnapshot()` reutiliza `buildMilestones` del lifecycle service (exportado junto con `LIFECYCLE_MILESTONE_INCLUDE`) para que la semantica de hitos tenga una sola fuente de verdad.
- Se removieron las dos tarjetas de texto estatico de la home que describian fases y "stubs" de Moondesk/SAP (ya desactualizadas).

## SAP (pendiente de Sistemas)
- Documento de requerimientos para el sector de sistemas en `docs/sap-integration-requirements.md`. Integracion de solo lectura del maestro de materiales; opciones de conexion en orden de preferencia (OData/REST, RFC/BAPI, vista de BD, export programado).
- Queda a la espera de que Sistemas confirme factibilidad y pase la API si existe.

## Pipeline por proyecto
- `getPipelineSnapshot` acepta `{ projectId, blockedItemsLimit }`: sin projectId agrega toda la cartera (vista ejecutiva), con projectId acota el mismo calculo a un proyecto. Un solo origen de verdad para la semantica de hitos.
- La pagina de proyecto muestra "Pipeline del proyecto" (solo las barras de cobertura) y la tabla de Project items gana la columna "Trabado en" con el primer hito faltante en orden operativo. No se repite el bloque de trabados del dashboard: en el proyecto la tabla de items ya es esa lista.
- `PipelineStagesCard` se exporta aparte de `PipelinePanel` para compartir las barras entre ambas vistas.
- Verificado: la suma de los pipelines por proyecto coincide exactamente con el global en los 5 hitos (9 componentes). PYLOBER muestra documentacion 75% (3 de 4) frente al 33% global, que era justamente el dato que la vista agregada escondia.

## Hallazgo pendiente (preexistente)
- En `projectsRepository.findById` las `alerts` del proyecto se traen sin `include` de `projectItem`, asi que la tabla "Alertas abiertas" de la pagina de proyecto muestra "Sin proyecto / Sin item". Se pierde a que componente corresponde cada alerta. Arreglo chico: agregar el include y ocultar la columna Proyecto en ese contexto.

## Proximo paso
A la espera de: (1) respuesta de Sistemas sobre conexion SAP, (2) API real de Moondesk. Mientras tanto (sin depender de terceros): arreglar el include de alertas del proyecto (ver hallazgo), o edicion basica de estados de items desde la UI.

## Restricciones vigentes
- SAP: a la espera de Sistemas (ver docs/sap-integration-requirements.md). No conectar hasta tener respuesta.
- Moondesk: integrado via reportes Excel (Tasks + Tasks_Times + Users_Tasks_Times). La API real reemplazara la fuente cuando este lista, manteniendo el servicio de aplicacion.
- No crear slots canonicos nuevos sin decision explicita.
- No expandir BOM a ciegas sin caso real y criterio de validacion.
