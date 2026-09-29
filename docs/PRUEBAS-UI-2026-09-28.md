# Pruebas de UI vista por vista, con datos reales — 28 de septiembre de 2026

Recorrido manual de la aplicación entera contra la base de producción, buscando lo que se
rompe de verdad al usarla. Todo lo que se escribió durante la prueba quedó revertido: al
terminar, un censo de las 41 tablas coincide con la instantánea previa sin una sola
diferencia.

Rama: `feat/qbo-report-invitaciones-2026-09-27` (los dos repos).

---

## 1. Qué se probó

53 rutas. 31 abiertas y usadas en el navegador (clics, búsquedas, filtros, selectores,
diálogos); las 22 restantes con una petición HTTP que confirma que el servidor las
entrega sin error. Backend y frontend corriendo en local, apuntando a la base y a la
cuenta de QuickBooks reales.

Vistas recorridas a mano: Dashboard · Projects (construction / completed / lost) ·
detalle de proyecto · reporte de QuickBooks del proyecto (los 8 reportes, causación y
efectivo) · Importar desde QuickBooks · Leads (por tipo, perdidos, en revisión) · detalle
de lead · Contacts · detalle de contacto · Company · detalle de empresa · Customers ·
Calendar · Tasks (tablero y lista) · Notes · Invoice scans · Reportes de QuickBooks
(backlog, outstanding) · Settings (users, roles, quickbooks, notifications, public links).

## 2. Lo que se arregló

### 2.1 La tabla se enviaba vacía desde el servidor

`useEntityTableLogic` sembraba las filas en un `useEffect`. En el servidor los efectos no
corren, así que la página se enviaba con el estado «no hay nada» aunque el loader ya traía
los datos, y sólo se llenaba cuando terminaba la hidratación. Con una compilación fría de
desarrollo eso fueron más de quince segundos de «No leads found» con doce leads cargados
detrás; hizo falta escribir en el buscador para que aparecieran.

Ahora el estado arranca con los items y el efecto se sigue encargando de los cambios
posteriores. El HTML del servidor pasó de traer el estado vacío a traer las 13 filas.
Afecta a todas las tablas de entidades: leads, proyectos, contactos, empresas.

*maros-next · `src/common/hooks/table/useEntityTableLogic.ts`*

### 2.2 La lista de pagos de un proyecto mostraba una fila de guiones

`/projects/:id/details` devuelve las transacciones de QuickBooks tal cual las da la API
(`txnDate`, `totalAmount`, `linkedTxn`), mientras que `/projects/financials` devuelve la
fila ya recortada (`date`, `amount`, `linkedInvoice`). La tabla leía sólo la segunda
forma, así que un proyecto abierto desde su propia página mostraba una fila entera de
guiones para un pago que sí existía. El proyecto 097-0726 ahora muestra
`2026-07-29 · factura 4062 · $1,000.00`.

*maros-next · `src/features/project/presentation/pages/ProjectDetailsPage.tsx`*

### 2.3 Un cero inventado en el estimado de QuickBooks de un lead

El backend responde con el bloque financiero en ceros y `found: false` cuando QuickBooks
no conoce ese número de lead. La ficha ignoraba `found` y decía «Estimate (QuickBooks)
$0.00», que es una cifra inventada: lo que pasa es que allá no hay estimado, no que valga
cero. Ahora dice «Not available», y un lead que sí tiene estimado lo sigue mostrando.

*maros-next · `src/features/leads/presentation/pages/sections/LeadInfoSection.tsx`*

### 2.4 Cifras de toda la empresa presentadas como si fueran del proyecto

El servidor ya declaraba el alcance de cada reporte (`scope`): QuickBooks sólo acepta el
filtro por cliente en algunos, y en el resto lo ignora y responde con los números de toda
la empresa. El frontend descartaba ese campo. «Saldo de proveedores (detalle)» listaba los
saldos de todos los proveedores de Maros bajo el título «Proyecto #097-0726». Ahora la
pantalla lo avisa arriba de la tabla.

*maros-next · `QboReport.ts`, `ProjectQboReportPage.tsx`*

### 2.5 Se podía invitar a alguien de fuera como administrador

El tipo de usuario y el rol son dos campos sueltos del formulario, así que nada impedía
mandar una invitación con «Externo» + rol `admin`. Contar las filas de `role_permissions`
no sirve para detectarlo: los roles de sistema no tienen filas y se resuelven al catálogo
entero, así que `admin` cuenta cero. Se miran los permisos efectivos.

- Servidor: `invite` rechaza con 400 `EXTERNAL_USER_ROLE_NOT_ALLOWED` antes de abrir la
  transacción, así que no crea usuario ni manda correo.
- Pantalla: al elegir «Externo», la lista de roles se acota a los que no dan permisos y se
  descarta la selección previa.

Comprobado contra la API: externo + admin → 400, externo + member → 400, externo + Solo
task → 400, externo + external → 201. Ninguno de los tres rechazos dejó filas.

*maros-nest · `user-invitations.service.ts`, `user.exceptions.ts` · maros-next ·
`InviteUserDialog.tsx`*

### 2.6 Un fallo de red se veía igual que una lista vacía

Los loaders del servidor degradan a lista vacía para que un endpoint caído no deje la
página en blanco. El problema es que así un fallo y un «no hay nada» se dibujan idénticos,
y el único rastro es una lista que no debería estar vacía. `orFallback` mantiene la
degradación y deja el motivo en el log del servidor.

*maros-next · `src/shared/infra/http/ssrFallback.ts`, `loadLeadsData.ts`*

## 3. Lo que quedó comprobado funcionando

- **Reporte de QuickBooks del proyecto**: los 8 reportes responden. Causación y efectivo
  dan resultados distintos y correctos — en 097-0726, causación fecha la factura el
  2026-07-17 y efectivo el pago el 2026-07-29. El formulario cambia solo: rango de fechas
  para los de período, fecha de corte para balance general y antigüedad.
- **Adjuntos de QuickBooks** (lo que antes era «Could not load QuickBooks attachments»):
  responde 200 y explica qué revisó — 4 transacciones revisadas, ninguna con adjuntos, con
  el detalle transacción por transacción.
- **Importar desde QuickBooks**: 103 jobs, cada fila con su estado y qué va a pasar («Se
  vincula a 002P-0525 · proyecto #4», «Se crea un lead y un proyecto nuevos»). La colisión
  real 283/387 sigue explicada con nombre y apellido, y sugiere `001R-0625 CO01`.
- **Proyecto sin vincular**: el botón «Llévame al reporte» queda desactivado y dice por
  qué; la API responde 409 con código, no un 500.
- **Dashboard, tableros y listas**: revenue 719.745, backlog 309.000, pipeline 1.028.745;
  46 tareas; 59 leads perdidos; 112 empresas; 265 contactos; 65 proyectos activos.
- **Ajustes**: usuarios con sus roles, catálogo de roles (external con 0 permisos y la
  descripción honesta), conexión de QuickBooks (realm enmascarado, sin filtrar el token),
  preferencias de notificación, enlaces públicos.

Pruebas automáticas: 382 en el backend y 209 en el frontend, todas en verde, con tres
casos nuevos (el rol de un externo, y que la tabla traiga filas en el primer render).

## 4. Lo que encontré y NO toqué

1. **Cinco contactos completamente vacíos** (ids 115, 116, 145, 254, 270): sin nombre, sin
   teléfono, sin correo y sin ningún lead. Salían primero en Contacts porque el orden por
   nombre pone los vacíos arriba, y la lista parecía rota. **Borrados el 28‑sep a petición
   de David**, con respaldo previo de las cinco filas; quedan 260 contactos y ningún lead
   huérfano. Dos traían algo suelto en el campo de dirección: el 145 decía «Meiret
   QUintero» (un nombre escrito en la casilla equivocada) y el 254 «esd33». La causa sigue
   abierta: `CreateContactDto` tiene `name` opcional, así que la API admite crear otro
   contacto vacío mañana.
2. **Customers lista los 265 contactos**, marcados casi todos como «Customer: No». Puede
   ser a propósito (desde ahí se marcan), pero el título dice «todos los clientes».
3. **Idiomas mezclados**: la importación de QuickBooks y el reporte están en español; el
   resto del CRM en inglés, y hay frases mixtas («Everybody else needs an invitation — use
   Invitar»).
4. **Alcance por filas**: `scoped_company_id` y `scoped_contact_id` se guardan y se
   devuelven, pero ningún módulo filtra por ellos. Mientras siga así, un externo no tiene
   nada que ver dentro del CRM.
5. **El calendario** funciona, pero sus celdas siguen siendo altas; si lo quieres más
   apretado es un ajuste de altura, no un rediseño.

## 5. Datos: qué se tocó y cómo volvió atrás

Durante las pruebas se escribió tres veces, siempre a propósito y con instantánea previa:

| Qué | Para qué | Cómo volvió |
|---|---|---|
| `projects.qbo_customer_id` del proyecto 137 → `576` | Probar el reporte con datos reales | Restaurado a `null` |
| Usuario + invitación `prueba-externo-5@example.com` | Comprobar que la regla deja pasar el caso válido | Fila e invitación borradas |
| 3 invitaciones rechazadas con 400 | Comprobar la regla nueva | No crearon nada |

Comprobación final: censo de las 41 tablas, sin una sola diferencia contra la instantánea
previa (4 usuarios, 4 roles, 22 permisos de rol, 0 invitaciones, 109 proyectos).

**Un efecto que no se puede revertir**: la invitación válida mandó un correo de verdad por
el SMTP de Gmail, desde `info@marosconstruction.com` a `prueba-externo-5@example.com`. Ese
dominio es de los reservados para pruebas y no hay nadie detrás, así que no le llegó a
ninguna persona; lo único que queda es un rebote en la bandeja de `info@`.
