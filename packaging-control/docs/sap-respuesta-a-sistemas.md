# Borrador de respuesta a Marcelo (Sistemas) — servicio a demanda del maestro de materiales

> Borrador para revisar y enviar. Acepta el servicio a demanda que ofrecieron, define con precisión qué pedir y en qué formato, y deja la puerta abierta a la API cuando pase el proyecto de HANA.

---

Hola Marce, gracias por la respuesta y por haberlo evaluado con el equipo.

El servicio a demanda nos sirve perfectamente para arrancar. La aplicación ya consume varias fuentes desde Excel (planillas de PM, recetas, altas de código y los reportes de diseño), así que sumar el maestro de materiales por esa vía no nos cambia la arquitectura: cuando más adelante exista la API, reemplazamos la fuente y el resto del desarrollo queda igual.

Te detallo lo que necesitaríamos para que la query les quede armada una sola vez y puedan re-correrla tal cual cada vez que se la pidamos.

## 1. Qué materiales

Todo el maestro de **material de acondicionamiento (packaging)**. En nuestra codificación interna son los códigos que empiezan con:

| Prefijo | Qué contiene | Ejemplos reales |
|---|---|---|
| `S`, `SA`, `SB`, `SC`, `SD`, `SE` | Impresos: estuches, prospectos, etiquetas | `SE09/70` EST.PYLOBER X120 CAPS. · `SC17/70` PROSP. KALI · `SB43/70` ETIQ. PERPIEL HUM. PROF. |
| `E`, `EA`, `EB`, `EC`, `ED` | Envases y complementos: frascos, aluminios, folias, pomos, bombas, tapas | `ED24/70` FCO.PERPIEL HERIDAS · `EC76/10` ALUM.GASTEC 40MG · `EA31/70` FOLIA TERBENOL UD |
| `K` | Cartones, neceseres, componentes de combo | `K045/10` CARTON COD EAN COMBO · `K064` NECESER COMBO |

**No** necesitamos: materias primas (`M...`), técnicas de control (`T...`, `TA...`), ni productos terminados / graneles / semielaborados (los numéricos tipo `1157O`, `1160L`, `0952H`).

Dos consultas sobre esto:
- Si en SAP el filtro natural es por **grupo de artículos (MATKL)** o por **tipo de material (MTART)** en lugar de por rango de códigos, decinos qué grupos/tipos corresponden a esos prefijos y filtramos por ahí, que seguramente les resulte más cómodo.
- Vimos también códigos con formato `FELE.../FELS...` con un número entre paréntesis (por ejemplo `(511005) FCO PEAD BCO 90ML BOCA 37`, `(512480) ETIQ GENIOL...`). Si esos corresponden a otra numeración o a otra sociedad, avisanos si conviene incluirlos o dejarlos afuera de esta primera vuelta.

Preferimos **el listado completo de packaging de una sola vez** antes que pedirles registros puntuales cada vez: así ustedes corren siempre la misma query y nosotros evitamos molestarlos con listas de códigos. Estimamos que son del orden de mil a tres mil materiales; si el volumen les resulta un problema, lo acotamos a los grupos que nos digan.

## 2. Qué campos

Por si les facilita armar la query, entre paréntesis va el campo técnico que suponemos corresponde (corrijan si en nuestra instalación es otro):

| Campo | Técnico (referencia) | Para qué lo usamos |
|---|---|---|
| Código de material | `MATNR` | Clave de vínculo con nuestros componentes. **Imprescindible** |
| Descripción | `MAKTX` | Conciliar contra la descripción interna. **Imprescindible** |
| Tipo de material | `MTART` | Clasificar el componente |
| Grupo de artículos | `MATKL` | Clasificar y filtrar |
| Marca de borrado | `LVORM` | Saber si el material está dado de baja |
| Estado del material | `MSTAE` / `MMSTA` | Distinguir activo, bloqueado, en creación |
| Unidad de medida base | `MEINS` | Conciliar con la receta |
| Fecha de creación | `ERSDA` | Antigüedad del código |
| Fecha de última modificación | `LAEDA` / `AEDAT` | Detectar qué cambió entre dos cortes |
| Proveedor / fuente de aprovisionamiento | — | Trazabilidad. **Opcional**: si no sale del maestro y hay que cruzar con registros de compras, lo dejamos para más adelante |

Sobre el punto de "código raíz y versión" de mi consulta original: ya lo aclaramos internamente, **no hace falta que lo manden**. SAP toma nuestro código como un identificador completo; la raíz y la versión (por ejemplo `SE09` + `/70`) son un constructo de nuestros procedimientos de packaging y los derivamos nosotros del propio código.

## 3. Formato del Excel

Para que la app lo lea sin intervención manual, lo ideal es lo más plano posible:

- **Una fila por material**, sin filas de subtotal ni de agrupamiento.
- **Encabezados en la primera fila** y datos desde la segunda.
- Una sola hoja con los datos (si agregan una hoja de portada o parámetros, sin problema, pero que los datos estén en su propia hoja).
- Sin celdas combinadas en el área de datos.
- Códigos de material **como texto**, tal como están en SAP (sin quitar ceros a la izquierda ni convertir a número).
- Fechas en formato fecha o `AAAA-MM-DD`.
- Que los nombres de las columnas y el nombre de la hoja se mantengan **iguales entre corte y corte**: si cambian, tenemos que ajustar el importador.

Si les resulta más cómodo un CSV, también nos sirve.

## 4. Frecuencia

Con un corte **mensual** nos alcanza para el seguimiento habitual, más algún pedido puntual cuando estemos cerrando un lanzamiento. Nada urgente ni automático.

Sería muy útil que en el nombre del archivo quede la fecha del corte (por ejemplo `maestro_packaging_2026-08-14.xlsx`), porque vamos a mostrar en la aplicación desde cuándo son los datos de SAP; así nadie interpreta que un material "no está en SAP" cuando en realidad el corte es viejo.

## 5. Reunión y la API más adelante

Sí, armemos la reunión, me parece buena idea para dejar esto cerrado en una sola pasada. Dos cosas que me interesaría ver ahí:

- Confirmar los grupos/tipos de material y ajustar la lista de campos con ustedes a la vista del maestro.
- Tener una idea aproximada de cuándo el proyecto de HANA les liberaría tiempo, para volver a poner sobre la mesa la API en ese momento. No es urgente: con el Excel avanzamos igual, y el trabajo que hagamos ahora sirve para las dos vías.

Gracias de nuevo por el tiempo y por buscarle la vuelta.

Saludos,
Santiago
