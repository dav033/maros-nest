# Trabajo nocturno del 28 de septiembre de 2026

Nueve encargos en paralelo, uno por agente, con los archivos repartidos para que no se
pisaran. Todo verificado contra la base y la cuenta de QuickBooks reales. Los datos de
prueba quedaron revertidos: la única diferencia contra la instantánea previa es la tabla
nueva que introduce la migración.

Rama: `feat/qbo-report-invitaciones-2026-09-27` (los dos repos).

---

## 1. Rendimiento

La auditoría encontró la causa raíz, y no era la que parecía: **la base de datos está a
130 ms de ida y vuelta** (Supabase us-west-1), con 0–3 ms de ejecución real. El tiempo de
respuesta es, casi siempre, *consultas en serie × 130 ms*. La prueba más clara es que
`/notifications/unread-count`, que devuelve **12 bytes**, tardaba lo mismo que
`/projects/all`, que devuelve **101 KB**.

El problema más caro era absurdo: **el token de QuickBooks se releía de la base en cada
llamada a la API** — 57 lecturas de `qbo_connections` en una sola petición a
`/projects/financials`, unos 7,4 s de pura latencia de red.

| Endpoint | Antes (frío / caliente) | Después (frío / caliente) |
|---|---|---|
| `/projects/financials` | 8 348 ms / 530–657 ms | **6 209 ms / 5 ms** |
| `/projects/all` | — / 263–398 ms | — / **138 ms** |
| `/contacts/all` | — / 517–607 ms | — / **142 ms** |
| `/analytics/project-health` | 50 100 ms (medido ayer) | **170 ms / 12 ms** |
| adjuntos de QuickBooks | 3 100 ms | 2 442 ms / **4 ms** |
| `/notifications/unread-count` | 265–272 ms | **142 ms**, y una sola vez por carga |

Qué se hizo: token de QuickBooks cacheado en memoria hasta poco antes de expirar, con
deduplicación de refrescos concurrentes; caché de `/projects/financials` en el servicio
(no con `CacheInterceptor`, porque `CacheModule` es por módulo y `/analytics/refresh` no
habría podido vaciarlo) y con la comprobación de `finance:read` **antes** del caché, para
que no le sirva a un usuario sin permiso la respuesta de uno que sí lo tiene; TTL de las
lecturas de QuickBooks de 5–10 s a 5 min con purga en escritura; adjuntos cacheados; y el
usuario resuelto cacheado 30 s **con invalidación explícita** al cambiar rol, `isActive`,
permisos de un rol o al revocar una invitación — el TTL es sólo red de seguridad, no el
mecanismo, porque el guard promete que una desactivación surte efecto de inmediato y esa
promesa no se podía romper. Comprobado en vivo: tras un `PATCH /users/11`, la petición
inmediatamente siguiente ya responde 403.

Fantasmas descartados, con medición: la compilación de desarrollo (9–38 s la primera vez,
446–1 324 ms ya compilada), los 703 KB de HTML que con gzip son 46 KB, y **no hay N+1 por
proyecto** — el enriquecimiento va por lotes. Detalle en `RENDIMIENTO-2026-09-28.md`.

## 2. Las barras de la lista de proyectos

Vuelven las **cinco barras en dos columnas** que tenía `main` — *Contract / Collected /
Spent* y *Profit vs Backlog* — con su aspecto original: etiqueta a la izquierda, cifra a
la derecha, barra debajo.

Se conservan tres correcciones que no son cosméticas: no se recorta al 100 % (un costo al
128 % del contrato cruza el borde y entra en la zona rayada, en vez de dibujarse igual que
uno al 100 %), no se toma valor absoluto (una pérdida cae a la izquierda del cero y en
rojo, en vez de verse idéntica a una ganancia), y todas las barras de una fila se miden
contra el mismo eje, igual en todas las filas, para poder compararlas entre sí.

## 3. Fichas de lead y de proyecto: pestañas

Se acabó el scroll larguísimo. Proyecto: *Resumen · QuickBooks · Tareas · Notas ·
Archivos*. Lead: *Resumen · Tareas · Notas · Archivos*. La cabecera con el título y las
acciones queda fuera de las pestañas, siempre visible.

Lo que más pesa no es el orden sino que **ya no se carga lo que no se ve**: la ficha de
proyecto pasó de **9 peticiones a 2** al abrirse, y la de lead de **11 a 6**. En crudo,
`/project/137` pasó de ~250 KB y varios segundos a **55 KB en 0,3 s**.

La pestaña activa va en la URL (`?tab=quickbooks`), así que el enlace se puede compartir y
recargar no devuelve a la primera. Se escribe con `history.replaceState` y no con
`router.replace`: la segunda dispara navegación blanda, que vuelve a ejecutar el loader del
servidor — una petición al backend por cada clic de pestaña.

## 4. QuickBooks: el reporte, el enlace y la advertencia

**"Llévame al reporte" fallaba en los 109 proyectos** porque exigía `qbo_customer_id`
guardado, y ninguno lo tenía; el resto de la ficha, en cambio, resuelve el cliente por
número de proyecto. De ahí la queja: decía que no estaba enlazado aunque mostraba datos de
QuickBooks. Ahora resuelve en dos pasos — vínculo guardado, y si no hay, coincidencia por
número — y el 409 sólo salta si fallan los dos. La pantalla dice de dónde salió el id y
sugiere fijarlo.

**No se hizo backfill** de los 109 enlaces, a propósito: la coincidencia por nombre es un
heurístico, y la pantalla de importación existe precisamente porque hay colisiones y
órdenes de cambio. Escribir vínculos que nadie decidió habría ocupado el índice único
parcial y bloqueado la importación correcta.

**Nuevo**: `PUT /projects/:id/qbo-link` con un diálogo buscable sobre los 103 jobs, para
enlazar un proyecto que ya existe. Idempotente, 409 si el job ya es de otro proyecto, y
cada cambio queda en bitácora. **Quitada** la advertencia al crear un proyecto sin enlazar.

Migración aplicada, idempotente y aditiva: `db/add-project-qbo-link-events.sql`.

## 5. Notas

Filas de 72 px a ~36 px: las ocho notas caben con sitio de sobra. Cinco diseños distintos
de fila para el mismo objeto unificados en uno. Árbol de 40 px a 28 px. La cabecera de la
nota dejó de gastar ~220 px en un título duplicado y una barra plegable vacía.

Lo de las tablas era **el editor**, no la lista: los márgenes de párrafo se aplicaban
dentro de cada celda, así que una tabla 3×3 vacía ocupaba ~210 px; ahora ~85 px. La banda
de encabezado era casi invisible, el redondeo no hacía nada bajo `border-collapse`, y los
controles eran ocho iconos sin etiqueta donde borrar-fila y borrar-columna eran dos
cuadrículas casi idénticas. Ahora son tres grupos rotulados (FILA / COLUMNA / TABLA) y hay
un selector de tamaño al insertar.

## 6. Esqueletos de carga

La causa de que el de tareas se viera mal: seis tablas pasaban un `loadingState` con un
spinner centrado en una caja de 150 px que **cortocircuitaba** el esqueleto real de
`EntityTable`, el que hereda el ancho de cada columna. Quitado el spinner, aparece el
correcto.

El de proyectos seguía dibujando la tabla de antes del rediseño: 7 columnas y 1 055 px
contra las 10 celdas y 1 490 px reales. Ahora se genera desde la definición real de
columnas, así que no puede volver a desincronizarse. Se corrigieron además contactos,
empresas, leads, fichas de detalle, widgets del panel y el tablero de tareas, y se añadió
esqueleto donde no había (tareas, panel, escaneos, la tarjeta móvil). Una sola animación
para toda la app, con un retardo de 200 ms que evita el parpadeo cuando la respuesta llega
en 50 ms.

## 7. Document scans

"Invoice scans" pasa a llamarse **Document scans** en pantalla y en el menú (rutas,
endpoints y tipos intactos). "Add transaction" y "Scan" abren ahora **modales** en vez de
navegar; al guardar, la lista se refresca sin recargar. Las rutas antiguas siguen vivas.

## 8. Calendario

Celdas de ~86 px a ~58 px, y la rejilla ya no pinta semanas que el mes no ocupa: el bloque
baja de ~500 px a ~280 px. El detalle del día se movió a un panel lateral, que era de donde
venía casi todo el vacío. Hoy y el día seleccionado se distinguen sin ambigüedad.

## 9. Error de consola

`transaction_without_attachment` se repetía como clave de React porque el código del aviso
es el *tipo* de problema, no su identidad: un proyecto con cuatro transacciones sin adjunto
generaba cuatro avisos con la misma clave. Arreglado.

---

## Estado de los datos

Censo de las 41 tablas contra la instantánea previa: **una sola diferencia**, la tabla
nueva `project_qbo_link_events` que introduce la migración. Los cuatro usuarios conservan
su rol (uno se cambió para probar la invalidación del caché y se restauró). Todo lo escrito
durante las pruebas está revertido.

**Una cosa que conviene mirar**: durante las pruebas del editor de tablas se escribió una
palabra dentro de una celda de la nota real *«test»* (id 24) y se deshizo. El contenido se
ve coherente, pero `updated_at` confirma que hubo escritura y no había copia previa para
comparar byte a byte.

## Pruebas

Backend **420** en verde (eran 382 al empezar la noche). Frontend **221** en verde (eran
206). `tsc --noEmit` limpio en los dos repos. Las 20 rutas principales responden 200 sin
errores de ejecución.
