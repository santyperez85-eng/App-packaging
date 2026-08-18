# Consulta de factibilidad — Conexión a SAP (lectura del maestro de materiales)

**Para:** Sector de Sistemas / SAP Basis
**De:** Santiago Pérez — Packaging
**Pedido concreto:** confirmar si es técnicamente posible que una aplicación interna **lea** datos del maestro de materiales de SAP, y por cuál método; y si existe una API/servicio, pasárnoslo.

> **RESPUESTA RECIBIDA (2026-08-14, Marcelo — Sistemas).** Técnicamente **sí es posible** desarrollar una API para consultar el maestro de materiales. Pero no tienen capacidad en el corto plazo por el **proyecto de HANA** en curso. Lo que ofrecen ya: un **servicio a demanda** — indicamos los grupos de materiales y los campos, ellos corren la query y devuelven un **Excel**, las veces que lo necesitemos. Ofrecen reunión.
>
> **Decisión:** aceptamos el servicio a demanda. Arquitectónicamente no cambia nada: el maestro SAP entra como una fuente Excel más, igual que PM, recetas, altas y los reportes de Moondesk. Cuando pase el proyecto de HANA se retoma la API y solo se reemplaza la fuente. El pedido concreto (grupos, campos y formato del Excel) está en `sap-respuesta-a-sistemas.md`.
>
> **Implicancia de diseño a tener en cuenta:** sin API no hay sincronización continua, así que el maestro va a estar tan fresco como el último corte que pidamos. La aplicación **debe mostrar la fecha del corte de SAP** junto al estado de formalización: sin eso, "el material no está en SAP" se confunde con "no actualizamos el maestro desde hace dos meses", y esa confusión llevaría a decisiones equivocadas.

> Este documento describe lo que la aplicación necesita (ya definido de nuestro lado) y lo que necesitamos que Sistemas confirme. Las definiciones de producto/proyecto ya están tomadas; **lo único que les pedimos decidir es la factibilidad técnica y el método de acceso.**

---

## 1. Qué es y para qué

Tenemos una aplicación interna de Control de Packaging que sigue el ciclo de vida de cada componente. La última pieza que falta es leer de SAP el estado de **formalización** del material (código definitivo, estado de compra, datos del material). Es una integración de **solo lectura**: la app no escribe nada en SAP.

---

## 2. Lo que necesitamos leer (definición nuestra, no requiere decisión de Sistemas)

A nivel de material maestro de **packaging** (envases, etiquetas, estuches, prospectos, aluminios, etc.):

- Código de material (número SAP completo) — clave de vínculo.
- Descripción.
- Estado / indicador de bloqueo (activo, bloqueado, marcado para borrado).
- Estado de aprovisionamiento / status de compra.
- Tipo de material.
- Proveedor / fuente de aprovisionamiento.
- Fecha de última modificación del registro.

> **Sobre raíz y versión:** SAP no diferencia versiones — trata cada código como un identificador completo. La semántica de "código raíz + versión" (p. ej. `SE09` raíz, `/70` versión) es propia de **nuestros procedimientos** de packaging, no de SAP. Por lo tanto la derivamos del lado de la app parseando el código; **no le pedimos a SAP raíz ni versión**, solo el código completo tal como lo guarda.

Volumen, frecuencia y entorno de prueba ya están definidos de nuestro lado (ver sección 4); no necesitamos que Sistemas opine sobre eso, solo que confirme si es viable.

---

## 3. Lo que les pedimos confirmar (esto sí es decisión de Sistemas)

1. **¿Es posible hoy una conexión de solo lectura al maestro de materiales desde una aplicación interna?** Si no lo es tal como está, ¿qué haría falta para habilitarla?
2. **¿Por cuál método?** En orden de preferencia nuestra, pero nos adaptamos a lo que el estándar de la casa permita:
   - API REST / OData (SAP Gateway / S/4HANA) — *ideal*.
   - RFC / BAPI vía conector (p. ej. `BAPI_MATERIAL_GET_LIST` / `BAPI_MATERIAL_GET_DETAIL`).
   - Vista de base de datos / réplica de solo lectura (HANA u otra).
   - Export programado (CSV/XLSX a carpeta de red o SFTP) — *suficiente para arrancar si lo anterior no es viable hoy*.
3. **Si existe una API/servicio**, pasarnos: endpoint o nombre del módulo de función, documentación o metadata (`$metadata` en OData), y los datos para autenticar en un entorno de prueba.
4. **¿Qué método de autenticación** soportan para un usuario de servicio de solo lectura (usuario/clave técnica, token/OAuth, certificado)?
5. **¿Hace falta algo a nivel de red** (segmento, VPN, whitelist de IP) para que la app alcance el endpoint?
6. **¿Existe un entorno de QA / réplica** contra el cual podamos desarrollar y probar antes de tocar producción?

---

## 4. Definiciones ya tomadas de nuestro lado (para su información)

- **Frecuencia:** una sincronización diaria nos alcanza en esta etapa.
- **Sincronización incremental:** si el origen expone fecha de última modificación, traemos solo lo cambiado; si no, carga completa.
- **Entorno:** preferimos desarrollar y probar contra QA/réplica antes de producción.
- **Credenciales:** las almacenamos de forma segura de nuestro lado (secreto/variable de entorno, nunca en código). Pedimos un usuario de servicio dedicado de solo lectura, no un usuario personal.
- **Filtro de alcance:** si se puede filtrar por grupo de artículos / tipo de material desde el origen, mejor; si no, filtramos packaging nosotros.
- **Raíz + versión:** es un constructo de nuestros procedimientos, no de SAP. El alta de un código nuevo (o de una nueva versión) nace de un procedimiento interno; SAP solo guarda el código resultante como un identificador completo. La app deriva raíz y versión parseando ese código.

---

## 5. Resumen del pedido

Necesitamos que Sistemas nos responda **si la conexión de solo lectura es posible y por cuál método** (sección 3, puntos 1–2), y en caso afirmativo nos pase la **API/endpoint y acceso a un entorno de prueba** (puntos 3–6). Con eso avanzamos del lado de la app.

---

*La integración SAP queda pendiente de la respuesta de Sistemas. En paralelo, la integración con Moondesk avanza sobre los reportes Excel disponibles hoy.*
