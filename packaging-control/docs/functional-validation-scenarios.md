# Functional Validation Scenarios

## 1. Componente Esperado Sin Evidencia
- PM define un componente aplicable.
- No existe BOM, pedido de codigo, material, SAP ni Moondesk.
- Esperado:
  - `project_item` nace como `PM_EXPECTED`
  - `expectedStatus=EXPECTED`
  - `matchingStatus=INFERRED`
  - `status=WAITING_CODE`
  - alertas: `EXPECTED_COMPONENT_MISSING`, `CODE_NOT_REQUESTED`, `PRE_BOM_MISSING`, `APPROVED_DOCUMENT_MISSING`
  - `readiness_score` muy bajo
  - `health_score` del proyecto bajo

## 2. Evidencia Sin PM Suficiente
- No hay expectativa PM usable.
- Existe pedido de codigo.
- Esperado:
  - el item nace por evidencia secundaria
  - `originMode=REQUEST_DETECTED`
  - `expectedStatus=EVIDENCED`
  - sin alerta de componente esperado faltante
  - alertas: `PRE_BOM_MISSING`, `REQUEST_WITHOUT_FORMAL_MATERIAL`, `APPROVED_DOCUMENT_MISSING`

## 3. Reconciliacion Correcta Entre Expectativa y Evidencia
- PM, BOM, pedido, maestro interno, SAP y documento aprobado convergen sobre el mismo item.
- Esperado:
  - un unico `project_item`
  - `originMode` sigue siendo el de expectativa
  - `expectedStatus=EVIDENCED`
  - `matchingStatus=EXACT`
  - sin alertas activas
  - `readiness_score` y `health_score` muy altos

## 4. Match Ambiguo
- Hay definicion esperada, pero las fuentes no convergen de forma confiable.
- Esperado:
  - `matchingStatus=AMBIGUOUS`
  - `status=BLOCKED`
  - alertas: `DEFINITION_AMBIGUOUS`, `CROSS_SOURCE_INCONSISTENCY`
  - readiness bajo

## 5. Codigo No Solicitado
- Existe expectativa y ya hay pre-BOM, pero no hay pedido de codigo.
- Esperado:
  - `expectedStatus=EVIDENCED`
  - `status=WAITING_CODE`
  - alerta `CODE_NOT_REQUESTED`

## 6. Documentacion Tecnica Faltante
- El material existe, pero faltan documentos tecnicos internos.
- Esperado:
  - codificacion resuelta
  - `status=WAITING_DOCS`
  - alerta `INTERNAL_TECH_DOCS_MISSING`

## 7. Documento Aprobado Sin Formalizacion Suficiente
- El circuito documental esta aprobado, pero no existe material formal.
- Esperado:
  - dimension documental en `ready`
  - dimension SAP en `partial`
  - alerta `REQUEST_WITHOUT_FORMAL_MATERIAL`
  - `status=WAITING_CODE`

## 8. Caso Casi Completo
- El proyecto tiene cobertura total de componentes esperados.
- Hay un item completamente listo y otro critico en revision final.
- Esperado:
  - `health_score` alto
  - el proyecto no puede cerrarse si el item critico sigue incompleto
  - no hay duplicados entre expectativa y evidencia

## 9. Selector PM Operativo
- Un workbook contiene una hoja PM operativa y hojas auxiliares como `Forecast`, resumen, base, compras, AARR o produccion.
- Las hojas auxiliares pueden contener textos como `Producto` y `Presentacion`.
- Esperado:
  - solo se selecciona la hoja PM operativa real
  - la hoja valida tiene producto, presentacion y estructura PM operativa
  - no se derivan componentes desde `Forecast` ni desde hojas auxiliares
  - `Caja` no dispara `ESTUCHE`

## 10. BOM/Recetas PerPiel Jabon
- PM valida: `Venta Libre-FARMA`.
- PM espera solo `FRASCO`.
- BOM/Recetas contiene el bloque `PERPIEL HERIDAS JABON x 250 ml (V)`.
- Esperado:
  - project_items finales: 1
  - `FRASCO` recibe evidencia BOM
  - `BOMBA JABON` queda como subcomponente/evidencia estructural del `FRASCO`
  - `CAJA` queda como nota/contexto logistico
  - no aparece `ESTUCHE`
  - `PRE_BOM_MISSING` queda resuelta para `FRASCO`
  - la evidencia BOM usa `sourceRecordKey` compuesto estable

## 11. BOM/Recetas PerPiel Spray
- PM valida: `Venta Libre-FARMA`.
- PM genera `FRASCO` y `PROSPECTO`.
- BOM/Recetas matchea el bloque `PERPIEL HERIDAS x 40 ML (V)` mediante alias/contexto manual.
- Esperado:
  - project_items finales: 2
  - `FRASCO` recibe evidencia BOM y resuelve `PRE_BOM_MISSING`
  - `PROSPECTO` no recibe evidencia BOM y mantiene `PRE_BOM_MISSING`
  - `BOMBA + TAPA PERPIEL HERIDAS` queda como subcomponente del `FRASCO`
  - `EST.PERPIEL HERIDAS` no crea `ESTUCHE` porque PM no lo derivo
  - `GRANEL`, `TC`, operaciones y O/M no crean items
  - no hay duplicados

## 12. Lifecycle operativo por project_item
- El sistema reconstruye el lifecycle de un `project_item` desde evidencias, alertas, readiness y status persistidos.
- El read model se consume desde `GET /api/project-items/:projectItemId/lifecycle`.
- Esperado general:
  - incluye `milestones`
  - incluye `timeline`
  - incluye `evidences`
  - incluye `alerts`
  - incluye `inconsistencies`
  - incluye `reconstructionGaps`
  - no modifica schema ni genera efectos laterales
- Caso `PYLOBER ESTUCHE`:
  - muestra expectativa PM
  - muestra pedido de codigo desde Alta de Mat
  - `CODE_NOT_REQUESTED` no queda abierto
  - persisten faltantes de pre-BOM y documentacion
- Caso `PerPiel Spray FRASCO`:
  - muestra expectativa PM y evidencia BOM confiable
  - `PRE_BOM_MISSING` queda resuelta
  - `BOMBA + TAPA` queda explicada como subcomponente/contexto, no como item separado
- Caso `Magnesio FRASCO`:
  - muestra expectativa PM
  - no muestra evidencia BOM final por ambiguedad
  - `PRE_BOM_MISSING` permanece activo
  - `reconstructionGaps` explicita que la ambiguedad fina de bloques BOM vive en diagnostics del adapter y no como evidencia persistida final

## Ejecucion
```bash
npm run validate:functional
npm run validate:project-item-lifecycle
```
