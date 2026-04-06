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

## Ejecucion
```bash
npm run validate:functional
```
