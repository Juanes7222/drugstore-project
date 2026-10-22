# Guía: escribir tests E2E reales del POS (Tauri ↔ NestJS ↔ PostgreSQL/Redis)

**Para quién es:** cualquier agente (o persona) que vaya a añadir cobertura E2E
real a `apps/pos-desktop`.

**Qué es esto:** la suite en `apps/pos-desktop/e2e/` no usa mocks. Levanta el
binario real de Tauri, lo maneja con `tauri-driver`, y apunta al NestJS real
contra Postgres y Redis reales. Cada test afirma sobre lo que quedó
**persistido en el servidor**, no sobre lo que devolvió una respuesta HTTP.

**Por qué importa:** la suite anterior corría contra un mock HTTP escrito a
mano. Era una segunda copia no verificada del contrato de la API: un cambio en
la forma real de una respuesta dejaba el mock en verde mientras la aplicación
se rompía. Compartir solo el cable HTTP es lo que hace que eso falle aquí.

Estado actual: **16 specs / 66 tests** (`sales-flow`, `sales-pricing-flow`,
`sales-config-flow`, `sales-credit-flow`, `credit-payment-flow`,
`server-rejection-flow`, `returns-flow`, `purchases-flow`,
`inventory-products-flow`, `inventory-adjustments-flow`, `clients-flow`,
`lot-expiry-flow`, `users-flow`, `tenant-config-flow`, `tenant-delivery-flow`,
`cash-shift-flow`).
Cobertura pendiente: ver §10.

---

## 1. Requisitos y comandos

| Requisito | Notas |
|---|---|
| Node + pnpm | monorepo, pnpm workspaces |
| Docker | para `postgres-test` (5433) y `redis-test` (6380) |
| `tauri-driver` | `~/.cargo/bin/tauri-driver` (Windows/Linux). Ver §3 |
| `msedgedriver` | lo descarga el harness a `e2e/.artifacts/`; no instalarlo a mano |

```bash
# Suite completa (levanta infra, migra, siembra fixtures, compila y corre)
cd apps/pos-desktop && pnpm test:e2e

# Un solo spec (el build sigue siendo parte del comando)
cd apps/pos-desktop && pnpm test:e2e:one ./e2e/returns-flow.e2e.ts

# Filtrar un test concreto
npx wdio run wdio.conf.ts --spec ./e2e/returns-flow.e2e.ts --mochaOpts.grep "E2E-R01"

# Reset manual de fixtures (el harness lo hace solo en onPrepare)
cd apps/server && npx tsx test/pos-e2e/reset.ts

# Typecheck del harness (los tests NO están en tsconfig.json normal)
cd apps/pos-desktop && pnpm typecheck:e2e

# Levantar/reparar la infraestructura a mano
docker compose -f docker-compose.test.yml up -d
```

Puertos que ocupa el stack E2E: **3000** (API), **4444** (tauri-driver),
**5433** (Postgres de test), **6380** (Redis de test).

---

## 2. La regla que gobierna todo lo demás

> **Afirma sobre el estado persistido en el servidor, no sobre la respuesta.**

El bug más caro de esta suite no es un selector mal escrito: es afirmar que
"la operación se encoló" cuando lo que importa es que el servidor la aplicó.
Una venta puede devolverse `200` y quedarse sin confirmar; una devolución puede
mostrar un toast y no existir nunca en la base de datos.

Por eso los asserts van contra Postgres con el cliente `pg`
(`e2e/server-state.ts`), contra filas reales: `Sale.changeAmount`,
`Lot.currentStock`, `FiscalDocument.fiscalState`, `SyncQueue.status`.

Las dos únicas fuentes de verdad son:

- `e2e/server-state.ts` — estado del **servidor** (Postgres vía `pg`).
- `e2e/local-state.ts` — estado del **dispositivo** (PGlite vía `window.__db`).

Y no basta con afirmar en una de las dos: una venta puede llegar al servidor
perfecta y quedar mal escrita en la base local — sin asignación de lote, sin
fila de pago, con el cambio en 0 — y el POS es quien la devuelve, la
reimprime y la arquea. Por eso `e2e/reconcile.ts` compara ambas proyecciones
campo por campo y `sales-flow` (S01) lo exige.

Cuando un test falla, el mensaje debe decir cuál de las dos está mal. "No pasó"
no es un diagnóstico.

---

## 3. Cómo se maneja la app

`tauri-driver` se usa **directamente**, como documenta Tauri, y no a través de
`@wdio/tauri-service`. El service sondea un bridge opcional
(`tauri-plugin-wdio`) en **cada** comando WebDriver; cuando el bridge no está,
cada sondeo es un `executeAsyncScript` fallido. Eso fue la fuente de
flakedness crónica de la suite anterior.

Dos errores que cuestan tiempo si no se conocen:

1. **Un worker por spec.** Con `maxInstances: 1` solo, wdio igual lanza un
   worker por archivo spec. Hay que poner **ambos**:
   `maxInstances: 1` y `maxInstancesPerCapability: 1`.
2. **El driver se inicia en `onPrepare`, no en `beforeSession`.**
   `beforeSession` corre por worker: el primer worker en terminar mataba el
   driver que el otro seguía usando, y el síntoma era
   `tauri-driver exited unexpectedly with code 1` sin relación con los tests.
   `onPrepare`/`onComplete` corren en el proceso principal, que es lo correcto
   para un servicio compartido por TCP.

`e2e/native-driver.ts` resuelve `msedgedriver` (descarga oficial si falta).
Tauri expone `window.__db` solo cuando `VITE_DEV_MODE=true`; el script
`test:e2e:build` ya lo define, y eso es lo que habilita `window.__db`.

---

## 4. Anatomía de un test

Estructura de `sales-flow.e2e.ts` / `returns-flow.e2e.ts`:

```ts
it("E2E-XNN: <afirmación observable>", async () => {
  // 1. Estado del servidor ANTES de actuar
  const baseline = await fetchLatestLocalNumber();
  const stockBefore = await fetchLotStocks();

  // 2. Sesión real
  await login(CASHIER.identifier, CASHIER.password);

  // 3. Accionar la UI como un cajero
  await addProductToCart("acetaminofén", ACETAMINOFEN);
  await goToPayment();
  await payWithCash(String(totalDue));

  // 4. Estado del servidor DESPUÉS (con polling: el replay es asíncrono)
  const sale = await waitForNewServerSale(baseline);
  expect(sale.lotStocks[LOT_ACETAMINOFEN]).toBe(stockBefore[LOT_ACETAMINOFEN] - 1);
});
```

Helpers disponibles en `e2e/helpers.ts`: `login`, `openReturns`, `goToPayment`,
`payWithCash`, `addProductToCart`, `waitVisible`, `waitEnabled`, `readPaymentTotalDue`,
`expectPesos`, `setCashReceived`, `resetForSpec`.

---

## 5. Reglas de polling (el error que más cuesta)

**No re-acciones lo que estás esperando.** El patrón

```ts
// MAL: cada tick vuelve a disparar la acción, y la acción resetea el estado
await browser.waitUntil(async () => {
  await searchInput.setValue(num);
  await (await $("button*=Buscar")).click();
  return (await $('input[type="checkbox"]')).isExisting();
}, { interval: 3_000 });
```

nunca converge si la acción limpia `foundSale`/selección al ejecutarse: el
resultado existe solo en la ventana entre ticks y el muestreo siempre cae
fuera.

La forma correcta separa **esperar el estado** de **actuar una vez**:

```ts
// 1. Espera a que el precondition sea real (el espejo local, por ejemplo)
await browser.waitUntil(
  async () => (await fetchLocalSaleItems(N)).every((i) => i.lotCount > 0),
  { timeout: 120_000, interval: 2_000, timeoutMsg: /* estado real, no "no pasó" */ },
);
// 2. Actúa UNA vez
await searchInput.setValue(String(N));
await (await $("button*=Buscar")).click();
await waitVisible('input[type="checkbox"]', 15, 1_000, "Item checkbox");
```

Además: el replay del servidor es asíncrono (cron cada 30 s), así que **todo**
assert de estado final necesita `waitUntil`, no una lectura única.

---

## 6. Fixtures: `apps/server/test/pos-e2e/`

`baseline.ts` siembra el mundo y **exporta los ids** que las aserciones del lado
POS consumen (`e2e/server-state.ts`). Los ids son constantes hardcodeadas en
ambos lados a propósito: si divergen, el fallo lo dice el test, no un `null`
misterioso.

Reglas del fixture, todas aprendidas a la fuerza:

1. **`TRUNCATE ... CASCADE`, nunca una lista de deletes a mano.** Una lista
   manual se pudre: mañana aparece una FK nueva en `Sale` y el spec falla lejos
   de la causa.
2. **Rol RLS vs. owner.** `APP_DATABASE_URL` usa el rol de la app
   (`pharmacy_app`, pasa por RLS); las fixtures usan el owner
   (`pharmacy_test`). Nunca pongas el superuser en `DATABASE_URL`: crea un
   camino silencioso que salta la seguridad que esta suite existe para
   verificar.
3. **El cliente genérico debe existir en el servidor.** El POS siembra
   localmente `CONSUMIDOR FINAL` (id fijo
   `00000000-0000-0000-0000-000000000001`) pero **nunca lo sube**. Como
   `ClientReturn.clientId` es `NOT NULL` con FK, toda devolución de una venta a
   consumidor final fallaba sin ese cliente en el servidor.
4. **Una resolución DIAN por tipo de documento.** `INVOICE` y `CREDIT_NOTE` son
   documentos distintos y cada uno necesita su `FiscalResolution` +
   `FiscalResolutionAllocation`. Sin la de `CREDIT_NOTE`, toda devolución muere
   con *"No active resolution allocation found … CREDIT_NOTE"*.
5. **`consecutiveNumber` debe estar fuera del rango que usa el POS.** Hay un
   `@@unique([consecutiveNumber, resolutionId])` y el POS numera 1..N. La venta
   foránea usa 9001.
6. **Turnos: `CLOSED` para ventas históricas.** El POS adopta el turno `OPEN`
   del servidor durante el arranque. Si la fixture pre-abre un turno, el POS se
   queda con el ajeno en vez de abrir el suyo y `SHIFT_OPEN` deja de converger.
7. **Campos que似乎 opcionales no lo son.** El error típico es
   `Argument 'X' is missing` de Prisma. Revisa el `.prisma` del modelo antes de
   escribir el `create`, no adivines: `Workstation` no tiene `subscriptionId`,
   `CashShift` no tiene `openedById` pero sí `userId` y `closedByUserId`, y
   `FiscalDocument` exige `cufeCude` (placeholder `PENDING_<docId>`),
   `issueDate` e `issuerNitSnapshot`.

Para sembrar una venta de **otra estación** (necesaria para probar el camino
cross-workstation) replica el patrón de `createForeignWorkstationSale`:
workstation + turno cerrado + venta `CONFIRMED` + `SaleItem` + `SaleItemLot` +
pago, y decrementa el stock del lote que consumió.

---

## 7. Precondiciones de negocio que el harness debe suplir

Dos reglas de negocio son **correctas en producción pero inalcanzables aquí**.
No las relajes en el código de la aplicación: ponlas en el harness.

**Nota crédito exige factura `VALIDATED`.** Nada en el stack E2E transmite a
DIAN, así que las facturas quedan eternamente en `PENDING_GENERATION` y toda
devolución falla. `validatePendingInvoices()` actúa como el proveedor DIAN,
acotado a los prefijos de las resoluciones del fixture (`POSE2E%`, `POSE2EC%`).

**El pull de ventas es incremental con cursor en `localStorage`.** El cursor se
avanza a "ahora" tras cada pull, y `resetLocalDatabase()` limpia PGlite pero
**no** `localStorage`. Una venta anterior al cursor de la corrida nunca volverá
a bajarse. Para preparar una venta foránea en un spec, `touchForeignSale()`
actualiza su `lastModifiedAt`, que es la misma señal que usa el producto cuando
otra estación modifica algo.

---

## 8. Fallar con diagnóstico, no con "no pasó"

Cuando algo no llega, el mensaje tiene que responder *qué falta y dónde*. Dos
anti-patrones reales de esta sesión:

- **"the toast never appeared"** cuando el toast solo aparece si el alta tuvo
  éxito: la página ya tenía el `role="alert"` con el mensaje real. Ahora
  `expectReturnToast` lee ese alert y lo reporta.
- **"the sale never arrived"** cuando la venta sí estaba en el espejo local pero
  su búsqueda fallaba: indistinguible asimple vista. Por eso existen
  `fetchLocalSales()` y `fetchLocalSaleItems()` en el mensaje de timeout.

Regla: si un timeout no dice el estado real de las dos fuentes de verdad, el
helper está incompleto. Agrégalo antes de seguir depurando a mano.

---

## 9. Bugs reales que esta suite encontró (no los "arregles" en el test)

Esta suite existe para eso. Cuando un assert falla, **investiga antes de
ajustar el assert**. Bugs encontrados y corregidos:

1. `ClientReturn.clientId: sale.clientId!` — toda devolución de consumidor
   final violaba la FK.
2. El tab "devolución no verificada" inventaba `saleId`/`saleItemId`
   (`UNVERIFIED-<ts>`, `manual-<id>`): **nunca pudo funcionar**. Los unit tests
   no lo detectaban porque mockean `create`/`confirm`.
3. `findSync` no incluía `items.lots` y `applySales` nunca persistía
   `SaleItemLot`: una venta de otra estación llegaba sin lote, y una devolución
   no tenía a dónde devolver el stock. `searchSale` además lanzaba sobre el
   array ausente.
4. `Sale.changeAmount` se persistía como 0 en local y servidor: el efectivo
   entregado vivía solo en el renderer y nunca se sincronizaba.
5. El pull de clientes usaba `$executeRawUnsafe`; el WebView de Tauri no tiene
   `SharedArrayBuffer`, así que PGlite no puede preparar esa sentencia ahí
   (pasaba en Node, fallaba en la app).
6. `selectCanConfirmPayment` ignoraba el efectivo entregado y habilitaba
   confirmar una venta con tarjeta sin efectivo que el servidor luego rechazaba.
7. **El wizard de cierre de turno se corría a sí mismo.** El resumen se
   calcula asíncrono (resuelve la vista operativa de cada factura del turno)
   y su llegada **sobrescribía el paso en el que ya estaba el cajero**: quien
   avanzaba al paso de conteo antes de que llegaran los totales volvía al
   resumen, y el paso de conteo que había alcanzado era el vacío. Ahora el
   wizard espera en un estado de carga hasta que los números son reales.
8. `e2e/local-state.ts` → `fetchLocalSyncQueue` estaba **roto**: su
   `WHERE $1::text IS NULL OR "operationType" = $1` fija el parámetro a texto
   y Postgres rechaza `enum = text`. No se notó porque el helper no lo usaba
   nadie: era código muerto. Lo encontró el test que lo puso a trabajar.
9. **Una negativa del servidor se clasificaba como regla de negocio.** El
   rechazo por operación llega con status 412 (el status del lote no dice nada
   de la operación individual), y esa rama de `classifyFailure` no miraba la
   palabra "validation": un payload que el esquema del servidor rechazaba
   quedaba registrado como `BUSINESS_RULE`. En la pantalla de salud de
   sincronización los dos casos se ven igual, y no lo son: uno es un error de
   captura y el otro una regla del negocio. Lo encontró `server-rejection-flow`.
10. **El modo de tarifa fija de los domicilios era inalcanzable.** La
    validación (en la pestaña y en el servidor) exige `fixedDeliveryFeeCents > 0`
    para el modo `FIXED`, pero el único control que podía fijar ese valor
    —el campo "Tarifa fija"— solo se renderizaba en modo `FIXED`. Ningún
    tenant podía cobrar una tarifa fija de domicilio: el único camino era
    poner el modo a mano por API. Ahora el campo de referencia también se
    muestra en modo `MANUAL`, de modo que el importe se fija primero y el modo
    se elige después. Lo encontró `tenant-delivery-flow` al intentar
    configurar la política por la UI.
11. **Un save de configuración rechazado deja la pantalla inservible.** El
    error queda en el store y `TenantConfigPage` sustituye **toda** la página
    —incluida la barra de pestañas— por el cartel de error. Y como el error
    solo lo limpia un `setConfig` exitoso, la siguiente forma de limpiarlo es
    el pull del sync: hasta 5 minutos con la pantalla rota, sin que el aviso
    diga que fue un conflicto de versión (dice "Error al cargar la
    configuración" y arrastra el error HTTP en inglés). Lo encontraron
    `tenant-config-flow` (T08/T09), que por eso terminan forzando un sync:
    sin él, el spec siguiente no puede ni abrir la pantalla.
12. **Borrar un campo numérico de la configuración guarda 0 en el servidor.**
    Los campos numéricos convierten el valor vacío en 0 y guardan en cada
    pulsación (`purchases-config-tab.tsx:274`, `strictness.section.tsx:324`,
    `delivery-config-tab.tsx:224`), así que seleccionar el contenido y
    reescribirlo deja el servidor **sin límite** durante la ventana entre el
    borrado y la escritura. Con `clientRequiredThreshold` es peor: el 0 se
    rechaza en el servidor (el modo `ABOVE_AMOUNT` exige un umbral > 0), el
    store local conserva el 0 y la pantalla muestra 0 mientras el servidor
    sigue con el valor viejo — una divergencia silenciosa. Lo delató el ruido
    de consola de los specs (dos `PUT` por cada campo), no un assert: los
    specs escriben el valor de una vez (`setConfigNumber` en
    `tenant-config-harness.ts`) para no dispararlo, así que **sigue sin
    cobertura propia**.

Al añadir un test, verifica también si el **mock** de un unit test existente
sigue siendo válido: si tu fix cambia la llamada que el código hace, el mock es
la siguiente víctima. Y comprueba si el helper que ibas a usar **está roto**:
un lector que nadie llama puede llevar meses roto sin que nadie lo note.

---

## 10. Cómo continuar la cobertura

Orden sugerido por relación esfuerzo/riesgo (el resto de la app sigue sin
cubrir; esto es lo que más valor da):

| # | Flujo | Nota |
|---|---|---|
| ✅ | **Turno de caja**: apertura, arqueo, cierre | `cash-shift-flow` (SH01–SH02): el turno que abre la app llega al servidor con el MISMO id y la venta queda colgada de él; el cierre desde la UI cierra el turno del servidor con el efectivo contado |
| ✅ | **Crédito de cliente**: pago y anulación | `credit-payment-flow` (CP01–CP02): el abono se escribe en local, se replayea al servidor (`CLIENT_CREDIT_PAYMENT`), y la DEUDA baja exactamente lo mismo en las dos bases; la anulación (`CLIENT_CREDIT_PAYMENT_ANNULMENT`) devuelve la deuda a su valor previo en ambas |
| ✅ | **Política de domicilios del tenant** | `tenant-delivery-flow` (DV01–DV07): `workflow.delivery` es el único bloque de la configuración que el POS **aplica** en runtime (`SalesPosService.validateDeliveryAgainstPolicy`). Los specs escriben la política desde Configuración → Domicilios y comprueban que el carrito ofrece el domicilio solo con la política activa, que cada requisito (cliente, dirección, teléfono, tope de tarifa) frena al cajero, que una venta válida guarda el domicilio (dirección y tarifa) en las dos bases, y que una política endurecida **por debajo** de una venta ya construida la hace rechazar **por el servicio** sin escribir nada |
| ✅ | **Propagación de la configuración al POS** | `tenant-config-flow` (T07): un cambio hecho en el servidor llega al POS en el siguiente ciclo de sync, no antes. El spec usa `tenant-config-harness.ts`, que escribe por API (con su propia sesión: el POS guarda el token en memoria y no se puede prestado) y fuerza el ciclo con el botón "Sincronizar ahora" de Salud de Sinc. |
| ✅ | **Negativa del servidor** | `server-rejection-flow` (N01): cuando el SERVIDOR rechaza lo que el POS aceptó (el formulario admite más códigos de barras de los que el esquema del servidor acepta), la cola local queda `PERMANENT_FAILURE`, con la categoría `VALIDATION` y el motivo DEL SERVIDOR, y el servidor NO crea el producto |
| 1 | **Compras**: devolución a proveedor | El replay de devolución a proveedor tuvo un bug de stock (§9, similar al #7); orden y recepción ya están cubiertos (`purchases-flow`) |
| 2 | **Inventario**: FEFO y venta que consume varios lotes | El ajuste por conteo está cubierto (`inventory-adjustments-flow`) |
| 3 | **Perfil del cliente**: consentimiento y venta a cliente desactivado | Crear/editar/desactivar ya están cubiertos (`clients-flow`), y la fila local ahora se reconcilia campo a campo con la del servidor |
| 4 | **Farmacia**: recetas y controlados | La venta de un producto controlado se rechaza en local (`PrescriptionRequiredNotSupportedException`), así que la vertical de recetas es inalcanzable |
| 5 | **Impresión**: recibo y nota crédito | El `PrintRouter` no está conectado al WebView todavía |
| 6 | **Caída de red**: cortar y reconectar a mitad de venta | El motor de reintentos merece E2E |
| 7 | **Configuración del tenant que no se aplica** | `strictness.cashShiftRequired`, `workflow.requireShiftOpenForSale`, `strictness.returnsRequireOriginalSale`, `strictness.clientRequiredThreshold` (el hook pasa `0` como total, así que `ABOVE_AMOUNT` nunca se activa), `workflow.autoPrintOnConfirm`, `sessionIdleTimeout*`, `prescriptionExpiryDays`… se configuran, se guardan y **no se leen en ningún sitio**. Antes de escribir el test hay que decidir si el comportamiento esperado es "se aplica" o "el control no debería existir" |
| 8 | **Concurrencia y RBAC de la configuración** | **Parcialmente cubierto.** `PUT /tenant-config` manda `expectedConfigVersion`: dos ediciones seguidas se pisan y la segunda recibe 409 (T08 lo comprueba: el servidor conserva el valor del otro admin y la pantalla avisa). ADMIN recibe 403 en toda escritura (T09) y la UI no marca nada como solo lectura. Falta: el rol **MANAGER** —que sí puede cambiar `workflow` y `purchases` pero no `strictness` ni `fiscal`— porque no hay fixture con ese rol (habría que crearlo con credenciales), y falta el mensaje de conflicto en condiciones: hoy es el cartel genérico de carga fallida con un error HTTP en inglés (ver §9.11) |

Al añadir un flujo nuevo, el checklist es:

1. ¿El fixture tiene todo lo que el replay necesita (ids, cliente genérico,
   resoluciones por tipo de documento, lote con costo real)?
2. ¿Alguna regla de negocio es inalcanzable sin un proveedor externo? → supler
   en el harness, acotado.
3. ¿El estado llega por push o por pull? Si es pull, recuerda el cursor de §7.
4. ¿El assert es sobre estado persistido? (§2)
5. ¿El polling es de espera, no de re-acción? (§5)
6. ¿El mensaje de fallo dice el estado real? (§8)
7. ¿`pnpm typecheck:e2e` y el spec pasan aislados antes de la suite completa?

Al terminar cada bloque, **correr la suite completa dos veces seguidas**: la
mayoría de la flakedness de este tipo de tests es estado residual entre specs,
y solo aparece en la segunda corrida.

---

## 11. Mapa de archivos

| Archivo | Rol |
|---|---|
| `e2e/wdio.conf.ts` | driver, workers, orden de los specs, ciclo de vida de infra |
| `e2e/real-backend.ts` | docker, migraciones, fixture reset, servidor NestJS |
| `e2e/native-driver.ts` | resuelve/descarga `msedgedriver` |
| `e2e/build-tauri.mjs` | compila el binario Tauri en modo `wdio` |
| `e2e/workstation-id.ts` | identidad de estación fijada |
| `e2e/server-state.ts` | **estado del servidor** (Postgres) + helpers de DIAN + turnos |
| `e2e/local-state.ts` | **estado del dispositivo** (PGlite) + aislamiento + espejo de venta/turno |
| `e2e/reconcile.ts` | diff campo por campo entre las dos proyecciones |
| `e2e/helpers.ts` | login, navegación, widgets, `expectPesos` |
| `e2e/sales-flow.e2e.ts` | S01–S06 (S01 reconcilia local ↔ servidor) |
| `e2e/sales-pricing-flow.e2e.ts` | S07–S11 (descuentos, override de precio, cantidades) |
| `e2e/sales-config-flow.e2e.ts` | SC01–SC04 (configuración de ventas global) |
| `e2e/sales-credit-flow.e2e.ts` | CR01–CR03 (venta a crédito) |
| `e2e/credit-payment-flow.e2e.ts` | CP01–CP02 (abono y su anulación; la deuda se reconcilia en las dos bases) |
| `e2e/server-rejection-flow.e2e.ts` | N01 (el servidor rechaza lo que el POS aceptó: la cola local queda `PERMANENT_FAILURE` con el motivo del servidor) |
| `e2e/returns-flow.e2e.ts` | R01–R02 (incluye el camino cross-workstation; R01 reconcilia la devolución local ↔ servidor) |
| `e2e/purchases-flow.e2e.ts` | P01–P06 (orden, recepción, costo, precio) |
| `e2e/inventory-products-flow.e2e.ts` | I01–I04 (alta, edición, precio, barcode duplicado) |
| `e2e/inventory-adjustments-flow.e2e.ts` | A01–A05 (ajuste por conteo, aislamiento, permisos) |
| `e2e/clients-flow.e2e.ts` | C01–C04 (alta, edición, desactivación) |
| `e2e/lot-expiry-flow.e2e.ts` | X01–X03 (lotes por vencer, vencidos, gating por config) |
| `e2e/users-flow.e2e.ts` | U01–U03 (alta, PIN, estado) |
| `e2e/tenant-config-flow.e2e.ts` | T01–T06 (configuración por tenant) y T07–T09 (propagación servidor → POS, conflicto de versión, RBAC de ADMIN) |
| `e2e/tenant-delivery-flow.e2e.ts` | DV01–DV07 (política de domicilios: la única parte de la config que el POS aplica) |
| `e2e/tenant-config-harness.ts` | **harness**: escribir la config por API y forzar el sync, para llegar a los estados que la pantalla no sabe expresar |
| `e2e/cash-shift-flow.e2e.ts` | SH01–SH02 (turno: apertura, arqueo, cierre) |
| `apps/server/test/pos-e2e/baseline.ts` | fixture del mundo + ids compartidos |
| `apps/server/test/pos-e2e/reset.ts` | TRUNCATE + siembra |
| `.github/workflows/pos-e2e.yml` | CI en `windows-latest` (bloqueante) |

Al añadir un spec nuevo, agregarlo a `specs:` en `wdio.conf.ts`.

**`cash-shift-flow` va último** a propósito: el turno es de tienda, no de
caja, así que cerrarlo dejaría sin turno a todos los specs que vinieran
después.

---

## 12. Problemas conocidos

- **El workflow de CI nunca se ha ejecutado en GitHub Actions.** El paso es
  bloqueante pero sus timings, la descarga de `msedgedriver` y la instalación de
  `tauri-driver` en el runner **no están validados**. Es lo primero que puede
  fallar en el primer push real.
- **7 errores de lint preexistentes** en
  `src/domain/sales-pos/sales-history.service.ts` (`no-empty` ×6,
  `prefer-const` ×1). No pertenecen a esta suite; conviene limpiarlos aparte.
- **`CREDIT_NOTE` puede quedar `PENDING_GENERATION`.** El stand-in de DIAN
  valida en el loop anterior a la aserción, así que el estado final de la nota
  crédito no siempre está `VALIDATED`. Los asserts verifican existencia y
  numeración (`^POSE2EC`), no su estado.
- **Windows-only.** `tauri-driver` directo necesita Edge WebDriver, que existe
  en Windows y Linux pero no en macOS. Para macOS el camino es el service con su
  servidor embebido.
- **El formulario de producto no impone el límite de códigos de barras del
  servidor.** El esquema del servidor acepta hasta 20 y el formulario local no
  tiene tope: un producto con 21 se guarda en el espejo del POS y se rechaza
  al llegar al servidor. `server-rejection-flow` (N01) deja el caso
  documentado a propósito —no se corrigió el formulario, para que la spec
  siga siendo alcanzable—; cuando el formulario imponga el mismo límite,
  esa spec tendrá que afirmar la negativa LOCAL en vez de la del servidor.
