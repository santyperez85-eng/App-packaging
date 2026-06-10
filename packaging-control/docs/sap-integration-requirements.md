# Requerimiento de integración con SAP — Control de Packaging

**Para:** Sector de Sistemas / SAP Basis
**De:** Santiago Pérez — Packaging
**Objetivo:** confirmar la factibilidad de conectar la aplicación interna de Control de Packaging con SAP para leer el maestro de materiales y su estado, y obtener el método de acceso (API/servicio) si existe.

---

## 1. Contexto

Estamos desarrollando una aplicación interna que controla el ciclo de vida del packaging de cada producto (desde la expectativa del PM hasta la formalización del material y la aprobación documental). Hoy la app consolida tres fuentes en planillas Excel: matriz PM, recetas y altas de código. La pieza que falta para cerrar el ciclo es **SAP**, que es donde el material queda **formalizado** (código de material maestro definitivo, estado de compra, datos del proveedor).

Necesitamos **leer** información de SAP de forma periódica. **No necesitamos escribir nada en SAP** — es una integración de solo lectura.

---

## 2. Qué datos necesitamos leer

A nivel de **material maestro** (por código de material SAP), idealmente estos campos:

| Dato | Para qué lo usamos | ¿Imprescindible? |
|------|--------------------|------------------|
| Código de material (número SAP definitivo) | Clave de vínculo con nuestros componentes | Sí |
| Descripción del material | Mostrar y conciliar contra la descripción interna | Sí |
| Estado / indicador de bloqueo (activo, bloqueado, marcado para borrado) | Saber si el material está vigente | Sí |
| Estado de aprovisionamiento / status de compra | Detectar materiales formalizados vs. en proceso | Sí |
| Tipo de material | Clasificar (envase primario, secundario, etiqueta, etc.) | Deseable |
| Proveedor / fuente de aprovisionamiento | Trazabilidad | Deseable |
| Código raíz y versión (si SAP los maneja) | Control de versionado del componente | Deseable |
| Fecha de última modificación del registro | Para sincronización incremental | Deseable |
| Unidad de medida y datos de formato/medidas | Conciliación con la receta | Opcional |

> Nota: el vínculo entre nuestros componentes y SAP es por **código de material**. Si SAP maneja un concepto de "código raíz" + "versión" (por ejemplo `SE09` con versión `/70`), nos sirve mucho conocer cómo está modelado, porque es central para nuestra lógica de cambios.

**Alcance de materiales:** solo materiales de **packaging / acondicionamiento** (envases, etiquetas, estuches, prospectos, aluminios, etc.). Si se puede filtrar por grupo de artículos / tipo de material desde el origen, mejor; si no, filtramos nosotros.

---

## 3. Métodos de conexión — en orden de preferencia

Nos adaptamos a lo que el estándar de la casa permita. De más a menos cómodo para nosotros:

1. **API REST / OData de SAP Gateway (SAP NetWeaver Gateway / S/4HANA OData)**
   La opción ideal. Un servicio OData de solo lectura sobre el maestro de materiales (p. ej. el servicio estándar `API_PRODUCT_SRV` o uno custom `Z...`). Consumimos JSON por HTTPS con paginación y filtro por fecha de modificación.

2. **RFC / BAPI vía conector** (p. ej. `BAPI_MATERIAL_GET_LIST` / `BAPI_MATERIAL_GET_DETAIL`)
   Si exponen un RFC habilitado, lo consumimos con un conector (node-rfc / SAP Cloud Connector). Necesitaríamos el nombre del módulo de función y los permisos del usuario de servicio.

3. **Vista de base de datos / capa de replicación** (HANA, vista de solo lectura, o réplica en otra base)
   Si existe una vista o réplica de solo lectura del maestro de materiales accesible por red interna, nos conectamos directo por SQL.

4. **Export programado** (CSV/XLSX a una carpeta de red o SFTP)
   La opción de mínima fricción si las anteriores no son viables hoy: un job que deje un export del maestro de packaging en una ubicación acordada con cierta frecuencia. La app lo levanta igual que hoy levanta las planillas. **Con esto podemos arrancar mientras se evalúa una conexión más directa.**

---

## 4. Detalles operativos que necesitamos definir

- **Frecuencia de actualización aceptable:** ¿diaria, cada varias horas, en tiempo real? Para nosotros una sincronización **diaria** ya es suficiente en esta etapa.
- **Volumen aproximado:** ¿cuántos materiales de packaging hay en el maestro? (para dimensionar la carga).
- **Sincronización incremental:** ¿el origen expone una **fecha de última modificación** para traer solo lo cambiado? Si no, hacemos carga completa.
- **Entorno:** ¿nos conectamos contra producción (solo lectura) o hay un entorno de QA/réplica para desarrollar y probar primero? Preferimos **probar contra QA/réplica**.
- **Red:** ¿la app necesita estar en un segmento de red específico / VPN / lista blanca de IP para alcanzar el endpoint?

---

## 5. Seguridad y credenciales

- Usuario de servicio **dedicado y de solo lectura** (no un usuario personal).
- Método de autenticación que prefieran: usuario/clave técnica, token/OAuth, o certificado.
- Acordamos el almacenamiento seguro de la credencial de nuestro lado (variable de entorno / secreto, nunca en el código).

---

## 6. Lo que pedimos concretamente

1. ¿Es posible hoy una conexión de **solo lectura** al maestro de materiales? ¿Con cuál de los métodos de la sección 3?
2. Si existe una **API/servicio** (OData/REST o RFC), pasarnos: URL/endpoint o nombre del módulo de función, documentación o metadata (`$metadata` en OData), y los datos para autenticar contra **QA**.
3. Si la vía es por **export programado**, acordar formato, columnas, ubicación (carpeta de red / SFTP) y frecuencia.
4. Confirmar el **modelo de código raíz + versión** en SAP (cómo se identifica un material y sus versiones).

Con esto avanzamos del lado de la app en cuanto tengamos su confirmación. Quedamos a la espera.

---

*Documento generado como insumo para la consulta a Sistemas. La integración SAP queda pendiente de su respuesta; en paralelo, la integración con Moondesk avanza sobre los reportes Excel disponibles hoy.*
