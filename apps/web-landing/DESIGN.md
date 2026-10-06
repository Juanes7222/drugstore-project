# PuntoFarma — Landing pública · Plan de diseño

> **PuntoFarma es un nombre de marca provisional.** El repo no define nombre
> de producto; se centralizó en `src/i18n/locales/es.json` (`brand.name`) y en el
> `<title>`/meta de `index.html`. Cambiarlo allí renombra todo el sitio.

## Sujeto, audiencia, trabajo de la página

- **Sujeto:** POS offline-first para droguerías colombianas con facturación
  electrónica DIAN y control de lotes INVIMA (el mismo `apps/pos-desktop`).
- **Audiencia:** dueño/a de droguería independiente en Colombia (y su
  contador), que hoy factura a mano o con un POS genérico que se cae.
- **Trabajo único de la página:** explicar el producto, responder las tres
  objeciones reales (¿y sin internet? ¿DIAN? ¿INVIMA?) y convertir a la
  compra de la licencia mensual vía checkout Wompi.

Los datos de precios NO se inventan: se importan de `DEFAULT_PLANS`
(`@pharmacy/shared-types`), la misma semilla que usa el servidor. Dos planes,
mismo precio ($199.000 COP/mes), mismas funciones; difieren solo en quién
maneja el certificado DIAN. Descuentos de período replican la fórmula exacta
del servidor (`checkout.controller.ts`): trimestral −10 %, anual −20 %.

---

## El concepto: la página es un documento

El producto del cliente imprime papel todo el día — la tirilla, el comprobante,
el resumen de suscripción. La página entera trata a su visitante como si
estuviera leyendo ese papel: una hoja continua, folios numerados, bordes
rasgados entre secciones y el botón de compra dentro de un troquel.

No es una metáfora de textura (sin grano, sin sombras de papel, sin imágenes de
papel viejo). Es una metáfora de **estructura**: los folios dicen dónde estás,
los bordes rasgados separan bloques reales, y el troquel final es la
conversión.

## Paleta (6 valores)

| Token | Hex | Por qué |
| --- | --- | --- |
| `papel` | `#F1F4EF` | Sustrato de papel térmico bajo luz fluorescente: verde-gris frío, ni crema ni blanco clínico. Fondo base. |
| `papel-alto` | `#FBFCFA` | Hoja levantada: documentos de plan, pantalla del POS, troquel. |
| `tinta` | `#111D17` | Tinta con base verde, no negro neutro. Texto y banda oscura. |
| `verde` | `#0F6B3F` | Verde farmacia de barrio. Acción primaria, folio, dato en vivo. |
| `grafito` | `#55655C` | Grafito de lápiz: texto secundario. `#55655C` sobre `papel` da 5.5:1, AA con holgura para las líneas de 12 px. |
| `ambar` | `#B45309` (fondo `#FBEEDD`, texto `#92400E`) | Único color de urgencia del dominio (lote por vencer). Aparece **una** vez, en la pantalla del POS. Nunca decorativo. |
| `verde-texto` | `#33996A` | Verde legible sobre la banda de tinta. El `--color-verde-claro` de acento da 4.3:1 contra `tinta`, bajo el piso AA del folio de 11 px; este da 4.9:1 y sigue leyéndose verde de farmacia, no menta. Mismo motivo que `ambar-texto`. |

Derivados: `verde-hondo #0A4A2B` (hover, precio), `verde-claro #2F8F60`
(acento sobre oscuro), `menta #DDEBE1` (bloque DIAN), `tinta-alta #18261F`.
Rayas siempre derivadas de `tinta` al 12–35 % de opacidad — nunca grises
genéricos.

**Tinta estructural como token, no como porcentaje suelto.** Tres pasos con
nombre cubren cada hairline, regla y borde de panel de la página:
`--color-line-quiet` (12 %), `--color-line` (20 %), `--color-line-strong` (30 %),
y sus equivalentes sobre fondo oscuro. Antes había veinte opacidades distintas
repartidas por ocho componentes; ahora el peso de línea del documento es una
sola decisión.

## Tipografía

| Rol | Fuente | Uso |
| --- | --- | --- |
| Display | **Schibsted Grotesk** 700 | La voz del rótulo de una droguería: humanista, aperturas abiertas, terminales blandos — institucional sin sonar maquinado. Solo en titulares: héroe a `clamp(2.4rem, 5.2vw, 4.1rem)`, folios de sección a `clamp(1.8rem, 3.4vw, 2.5rem)`, conceptos a `1.125–1.25rem`. Nunca en párrafos. |
| Cuerpo | **IBM Plex Sans** 400/500 | Lectura larga en pantalla chica. |
| Datos | **IBM Plex Mono** 400/500/600 | **Todo** número que importa: precio, lotes, NIT, folios, horas, colas. Dígitos tabulares por naturaleza. |

> Se empezó con **Saira Condensed** y se cambió: leía demasiado cuadrada, con
> terminales cortados a escuadra. Schibsted Grotesk es la misma voz
> institucional (grotesca de diario) con las curvas y el aire de una humanista.

Regla dura: **ningún peso aparece fuera de Plex Mono.** Si es dinero o dato
fiscal, va en mono. Por eso el precio protagonista (`$ 199.000` a
`clamp(3rem, 7vw, 5.4rem)`) está compuesto en mono y no en la display: es la
línea de total de un comprobante, y un número tan grande en grotesca habría
parecido una estadística de plantilla.

**La placa es el precio que se paga, no el de lista.** Muestra el monto mensual
efectivo del período elegido, y cuando ese período trae descuento, el precio de
lista aparece encima tachado. La decisión anterior — placa fija en el precio base
y la equivalencia mensual en una línea de 14 px junto al selector — estaba
defendida como "el precio es la tesis de la sección", y en la práctica sale
pobre: un número de 5,4 rem que no se mueve al elegir un período más barato no
es un precio, es un titular. El ojo va a la placa; el descuento tiene que estar
ahí.

El tachado es un `<s>` real —la semántica de "esta cifra ya no aplica" la
reciben las tecnologías de asistencia— con la línea dibujada por un
seudocliente en vez de por `text-decoration`, para que pueda barrerse de izquierda
a derecha al cambiar el período: el mismo motivo de *la línea se dibuja* que el
rasgado, la regla del total y los nodos de activación.

Y el estado oculto de ese barrido vive en el keyframe `from`, no en la regla
base, por la misma razón que el resto de la página: sin animación, el precio
de lista tiene que seguir viéndose tachado.

La fila del precio de lista reserva su alto aunque no haya descuento, para que
cambiar de período no mueva la placa.

`.folio` (mono 11 px, `letter-spacing: .2em`, mayúsculas) es la única voz de
etiqueta del sitio y siempre lleva un número de folio real.

**La etiqueta del héroe no flota sobre el titular.** La hoja del héroe abre con
el encabezado impreso que lleva un recibo: `01 / 06 · POS PARA DROGUERÍAS
COLOMBIANAS` a la izquierda, el id del documento a la derecha, y la regla
debajo. Eso dice en qué folio de seis está el lector —que es información, no
adorno— en la posición donde un recibo la pone, en vez de como un kicker
pegado encima de un titular enorme, que es la forma por defecto del hero
SaaS. Debajo del encabezado, ninguna sección vuelve a llevar etiqueta sobre su
título: el titular se sostiene solo.

## Estructura

Las secciones no son cajas iguales. Cada una cambia de suelo, y el cambio está
marcado por un **borde rasgado** que se abre de izquierda a derecha al entrar en
pantalla.

```
┌──────────────────────────────────────────────────────────────────────┐
│ ✚ PuntoFarma      Mostrador Planes Activación Preguntas  [Comprar]   │
│ ────────────────────────── barra de lectura ────────────────────────  │
├──────────────────────────────────────────────────────────────────────┤
│ 01 / 06 · POS PARA DROGUERÍAS COLOMBIANAS   Documento PF·LIC · Col.  │
│ ────────────────────────────────────────────────────────────────────  │
│                                                  │  PANTALLA DEL    │ │
│ La caja que no se detiene                        │  POS (HTML/CSS)  │ │
│ cuando se va internet.                           │  líneas que se   │ │
│                                                  │  imprimen        │ │
│ Cobre, revise lotes y facture ante la DIAN…      │  · scanline      │ │
│ [Comprar licencia →]  Ver planes                  │  · cola · total  │ │
│ [FACTURACIÓN DIAN][LOTES INVIMA][VENDE SIN…]     │                  │ │
│ Sin contrato de permanencia · Cancele cuando…    └──────────────────┘ │
│ ╱╲__╱╲__╱╲__╱╲__╱╲__   ← borde rasgado                             │
│ FOLIO 02 · MOSTRADOR                                                 │
│ Lo que pasa en el mostrador                                          │
│ ┌─ LOTES ────────┐ ┌─ FÓRMULA ───────┐ ┌─ TURNO 38 ──────┐           │
│ │ LOTE  VENCE  E │ │ Código F-00214 │ │ Base    $ 200.000│           │
│ │ L-2481 30sep ⚠│ │ Firma  Firmada │ │ Ventas  $1.284.5k│           │
│ │ L-2477 12nov  │ │ ✓ Verificada   │ │ Contado $1.484.5k│           │
│ └────────────────┘ └────────────────┘ └──────────────────┘           │
│ Escaneo y lotes   Fórmula médica    Turno de caja                    │
│ ╱╲__╱╲__╱╲__╱╲__   ← borde rasgado                                  │
│ ███ BANDA OSCURA A SANGRE (tinta) — folio 03                        │
│ Se fue internet. La caja sigue abierta.  ┌── TERMINAL FIJADA ────────┐ │
│ 01 Cobra como siempre                   │ ╭ Droguería La Esper. ╮  │ │
│ 02 Se guarda en el equipo               │ │ Escanee o busque… ◐   │ │ │
│ 03 La cola sube sola                    │ │ Carrito               │ │ │
│ 04 Queda enviada ante la DIAN           │ │  Losartán ×1 $ 9.800  │ │ │
│ ─ regla que baja con el scroll          │ │  IVA (0 %)      $   0 │ │ │
│                                         │ │  Total        $ 9.800 │ │ │
│                                         │ ╰───────────────────────╯ │ │
│                                         │ TIRILLA · VENTA #1045     │ │
│                                         │  Subtotal · $ 9.800       │ │
│                                         │  … una línea por scroll…  │ │
│                                         └───────────────────────────┘ │
│ ╱╲__╱╲__╱╲__╱╲__                                                      │
│ FOLIO 04 · PLANES                                                    │
│ Un precio. Dos maneras de facturar.                                  │
│ LICENCIA POS · TODAS LAS SEDES                                      │
│ $ 199.000  ← placa, mono                  PERÍODO DE PAGO           │
│ al mes                                   [Mensual][Trimestral][…]    │
│            · ══ dos documentos impresos, idénticos salvo el bloque  │
│              ══ DIAN, que va primero porque es la única diferencia ═  │
│            · 3 puestos por sede · puesto adicional $40.000 · …      │
│ ╱╲__╱╲__╱╲__╱╲__                                                      │
│ FOLIO 05 · ACTIVACIÓN  ─□──────────□──────────□─                     │
│ 01 Escoja su plan y pague │ 02 Reciba su código │ 03 Actívelo…        │
│ ╱╲__╱╲__╱╲__╱╲__                                                      │
│ FOLIO 06 · PREGUNTAS — dos columnas, todo abierto, sin acordeón      │
│ ╱╲__╱╲__╱╲__╱╲__                                                      │
│ ███ BANDA VERDE + troquel: "Abra su turno hoy."  ╭ torn ╮            │
│                                            PF·LIC … Total  [Comprar]  │
│                                                        ╰ torn ╯       │
│ ███ pie: atrás del documento                                          │
└──────────────────────────────────────────────────────────────────────┘
```

Ancho de contenido: `max-w-[78rem]` (1248 px), `px-5 sm:px-8`. Padding vertical
de sección: `pt-12 pb-20` (móvil) → `lg:pt-16 lg:pb-28`. El suelo se alterna
para que el rasgado tenga dos lados: `papel → papel-alto → tinta → papel →
papel-alto → papel → verde → tinta`.

## Firma

**El borde rasgado.** Un solo mecanismo, repetido en cada frontera: la
perforación se abre con un barrido de `clip-path` de izquierda a derecha cuando
la sección entra en pantalla. Los mordiscos son semicírculos del color de la
hoja de arriba comiendo el borde de la de abajo, así que el corte tiene dos
lados como el papel real.

Debajo de ese gesto, todo lo demás repite **el mismo motivo, nunca uno nuevo**:

| Motivo | Dónde |
| --- | --- |
| *La línea se dibuja* | rasgado (horizontal), regla del total (horizontal), regla de activación (horizontal) |
| *El papel se imprime* | líneas del carrito, filas de los paneles del mostrador, documentos de plan, troquel final |
| *La máquina está viva* | scanline del POS de portada, giro del glyph de cola, drenaje de la cola, conteo de cifras |

El resto de la página —títulos, párrafos, botones, footer— está quieto. El
rasgado es el único lugar donde se gasta la osadía.

## Mostrar, no decir

La regla de contenido que gobierna la página: **si el POS puede demostrar algo,
la página lo demuestra y no lo escribe.** Una captura vale más que un párrafo,
y además es verdad — el producto es exactamente eso.

| Afirmación | Cómo se demuestra |
| --- | --- |
| El lote y el vencimiento entran con el producto | Panel de inventario con `LOTE / VENCE / EXIST.`, la fila por vencer en ámbar |
| La fórmula se pide aparte | Panel con código, firma y «Verificada» |
| El turno cuadra | Panel que cuenta base, ventas y contado en vivo hasta `$ 1.484.500` |
| Sube sola, en orden, sin duplicados | La cola se **drena sola** al entrar en pantalla: una barra, tres ventas, un «en cola» que se vuelve «enviada» |
| Los dos planes solo difieren en el certificado | Dos documentos idénticos con un único bloque distinto, arriba del todo |

Consecuencia medible: la sección del mostrador tiene 78 palabras de prosa y
tres pantallas. El bloque más texto de la página es el FAQ (206 palabras), que
es la lista de objeciones — ahí el texto *es* el contenido.

Lo que se quitó por esto: la descripción del plan que repetía el bloque DIAN
palabra por palabra, el ticker que repetía los datos del mostrador, y el cuarto
pilar («Se sincroniza solo»), cuya prueba es ahora la banda de cola.

## Movimiento

Un momento orquestado por sección, nunca efectos sueltos. Todo se ata a la
posición del lector y termina en su estado final.

| Sección | Momento |
| --- | --- |
| Portada | las líneas del carrito se imprimen escalonadas al cargar; scanline y giro del glyph de cola |
| Mostrador | las filas de cada panel se imprimen al entrar; el chip ámbar parpadea **una vez**; las cifras del turno cuentan hasta su valor y el chip «Cuadra» pulsa cuando cierran |
| Sin conexión | la venta se representa: la terminal avanza por cuatro estados y la tirilla se imprime línea a línea |
| Planes | las cifras y los documentos se imprimen al llegar la sección; al cambiar de período el documento se estampa **Reimpreso** |
| Activación | la regla se dibuja y los tres nodos caen sobre ella |
| Preguntas | fade-up |
| Troquel final | el documento se imprime |

Además: el rasgado de cada frontera, la barra de lectura del header y el latido
del punto de estado. **Un solo loop ambiental** (el scanline del POS de la
portada) — el resto es una pasada.

### Todo el scroll es CSS, no JavaScript

Cada entrada de la página es una animación *ligada al scroll* mediante una
timeline `view()` anónima sobre el propio elemento que se mueve. Dos
consecuencias que conviene no perder:

- **Ningún reveal cuesta un `IntersectionObserver`.** No hay escrituras de
  estado de React ni callbacks en el hilo principal durante el scroll, que es
  exactamente lo que mide INP. Solo quedan observers donde el estado es
  genuinamente discreto: qué sección está en vista, y si la barra de compra
  móvil ya salió del héroe.
- **El estado en reposo de cada elemento es su estado *final*.** La animación es
  una capa sobre contenido visible, no lo que lo hace aparecer. Por eso
  `prefers-reduced-motion` no necesita bloques de cancelación: necesita que las
  animaciones nunca se declaren, que es lo que hace el gate
  `prefers-reduced-motion: no-preference`. Y un navegador sin
  `animation-timeline` muestra la página terminada en vez de una en blanco.

Los rangos se expresan contra `cover`, no con un offset fijo: `cover` va desde
que el elemento empieza a ser cubierto por el scrollport hasta que deja de
estarlo, así que el estado final siempre es alcanzable incluso para un elemento
más alto que el viewport o situado al final del documento — los dos casos que
dejan las reveal con `entry` congeladas en su primer frame.

`useCountUp` sigue siendo JavaScript (contar a un valor no se puede expresar en
CSS aquí), pero **escribe `textContent` directamente en el nodo**. Tres cifras
del turno contando a la vez re-renderizarían React sesenta veces por segundo en
plena lectura, que es justo el trabajo del hilo principal que INP penaliza.
React sigue renderizando el valor final como contenido del elemento, así que la
cifra es correcta sin JavaScript.

### La banda sin conexión se representa, no se describe

Antes la sección afirmaba en prosa que las ventas se guardan y suben solas, y
drenaba una cola ilustrativa en un temporizador para demostrarlo. La afirmación
que vale la pena es una *transición* —cobrar, perder la red, retener, enviar— y
una transición es justo lo que un scroll puede ejecutar.

**Cada paso y la pantalla que lo demuestra son la misma fila de la rejilla**, y
la terminal queda fija mientras ese paso cruza la pantalla. El emparejamiento es
estructural, no calculado: "estás leyendo el paso N, estás viendo la pantalla N"
se cumple por construcción, mida lo que mida el texto o el viewport. No hay
crossfade entre pantallas superpuestas ni aritmética de porcentajes sobre el
recorrido de una pista única.

> La primera versión de esto ponía una pista de 200vh al lado de una columna de
> prosa de ~800px y derivaba las cuatro ventanas del recorrido de la pista. Las
> pantallas no caían nunca sobre su paso, y sobraban ~1000px de negro por cada
> pantalla de scroll — exactamente lo que se reportó. Encima, las cuatro
> pantallas iban en `position: absolute; inset: 0` dentro de un stage sin hijos en
> flujo, así que **el stage medía cero** y todas se apilaban en el mismo origen.
> Ninguna de las dos cosas se ve mirando el código; hace falta mirarlo scrolleando.

Cada fila nombra su propia `view-timeline`, así que la línea de estado y la
tirilla que se imprimen dentro de ella —incluso dentro de la terminal fija— la
resuelven sin `timeline-scope` y sin depender de la altura total de la pista.

La altura de fila es `78vh` con **techo de `60rem`**: la fila tiene que ser más
alta que la pantalla que fija para que quede recorrido, pero más allá de ~960px
no hay nada más que leer, y un `vh` sin techo convierte la sección en negro en un
monitor alto.

Los cuatro estados son UI real del POS y cada etiqueta es algo que el producto
reporta de verdad. Offline es trabajo normal, así que nada dentro está tratado
como error. La tirilla se imprime línea a línea en la última fila, atada a esa
fila: es el documento entero —subtotal, impuesto, total y número de factura— en
ese orden.

Los cuatro pasos en prosa llevan cada hecho; la terminal es la prueba de esos
hechos y está `aria-hidden` en vez de leerse dos veces.

### El estado en reposo es el estado final

Ningún reveal declara un estado oculto en su regla base. El estado "oculto" vive
en el keyframe `from`, que `animation-fill-mode: both` aplica antes de que su
rango empiece.

Eso es lo que hace que el gate `@supports (animation-timeline: view())` sea
seguro en vez de peligroso. Con un `opacity: 0` o un `clip-path: inset(0 0 100% 0)`
en la base, cada reveal depende **por completo** de que su animación exista: en
un navegador sin scroll timelines —o con `prefers-reduced-motion`— desaparecían
los bordes rasgados, las hojas impresas, la fila del total, la línea de los pasos
de activación y las líneas de la tirilla. La página entera depended de una
función CSS.

### Reduced motion

Con `prefers-reduced-motion: reduce`: cero animaciones en marcha. Lo que queda
son los dos efectos que dependen de estado discreto y no del scroll —la barra de
compra y el diálogo— que cambian su movimiento por un fundido plano. El
documento ya está en su estado final en todas partes.

### El bug que causó el rediseño

`IntersectionObserver` mide el rectángulo **ya recortado**. El reveal de
impresión usaba `clip-path: inset(0 0 100% 0)` sobre el propio nodo observado:
ratio de intersección 0, `threshold: 0.1` inalcanzable, `data-printed` nunca
pasaba a `"true"`. Los dos documentos de plan y el troquel final **no se veían
nunca** — más de 1000 px de sección de precios en blanco.

Regla que quedó: **el nodo observado jamás lleva el `clip-path`.** El recorte
vive en un hijo (`.print-face`). El mismo razonamiento aplica a `.tear`.

La migración a `view()` eliminó los dos hooks que carryban ese estado
(`data-visible` / `data-printed`) y con ellos la clase entera de bugs.


## Copy

- Español, sentence case, voz de asesor de confianza, frases cortas,
  consecuencias concretas en vez de listas de funciones.
- Una idea por bloque. El enunciado del héroe son 13 palabras; cada fila del
  mostrador, una frase.
- **Una sola vez.** La historia de "sincroniza solo" aparece en la fila del
  mostrador y en la banda offline, no en un ticker además. Las condiciones y
  las inclusiones, idénticas para los dos planes, viven en dos tiras mono bajo
  los documentos — no en tres párrafos de letra chica repetidos.
- Acciones con verbo y en voz activa, mismo nombre en todo el flujo:
  «Comprar licencia» produce «Redirigiendo…».
- Nada promete lo que el sistema no documenta (importación de inventario,
  tiempos de entrega, SLA). El canal de soporte sigue vacío
  (`support.channel_email`): el footer no renderiza nada hasta que exista una
  dirección real.

## Accesibilidad y calidad de base

- Skip link al foco → `#contenido`; `scroll-padding-top` global para que todo
  ancla desahogue el header pegajoso sin offsets por elemento.
- `aria-current` en la navegación según la sección en vista
  (`useActiveSection`, un solo observer para header).
- Selector de período con `radio` nativos: conserva las flechas del teclado.
  Foco visible con `peer-focus-visible` + `outline` (2 px verde, offset −2).
- El grupo de radios y la pantalla del POS no son tabulables de más: el POS es
  `role="img"` con etiqueta, su botón lleva `tabIndex={-1}`.
- La barra de compra móvil es `role="complementary"`: un `aria-label` sobre un
  `div` genérico se ignora, y ese es el elemento de conversión persistente en
  todo el móvil.
- Controles de 44 px mínimo (`.btn`, `.btn-sm`), `cursor: pointer`,
  `touch-action: manipulation`. El botón de pago del diálogo declara su estado
  deshabilitado.
- Formulario de checkout: `noValidate` + errores por campo debajo del input,
  `aria-invalid`, `aria-describedby`, foco al primer inválido.
- Chips a 12 px por token (`--text-chip`), nunca 11 px: el límite de legibilidad
  está declarado una vez y no puede volver a bajarse.
- Contraste AA verificado: `grafito` 5.5:1 sobre `papel`, `ambar-texto` ≈6:1
  sobre su fondo, `verde-texto` 4.9:1 sobre `tinta`, `papel-alto/75` sobre
  `tinta` ≈9:1.
- `forced-colors: active`: la estructura del documento la llevan hairlines, así
  que las superficies que dibujan su propia forma reciben borde de color de
  sistema en vez de desaparecer.
- `prefers-contrast: more`: solo se mueven los pasos de tinta silenciosos y el
  grafito. La tinta en sí se queda donde la paleta la puso.
- Sin desbordamiento horizontal a 390 px. Las tres tablas del mostrador
  esperan a `md` antes de ponerse en tres columnas: por debajo, cada panel es
  un argumento completo y merece el ancho completo.
- `prefers-reduced-motion`: 0 animaciones en marcha, 0 elementos sin revelar.
- Sin bucles de animación con `prefers-reduced-motion`.
- Paginación de fuentes: la hoja de Google Fonts sale de la ruta de render y
  solo se piden los pesos que la página usa, con fallbacks métricos
  (`ascent-override` / `descent-override` / `size-adjust`) para que el cambio de
  tipografía no mueva el LCP.
- JSON-LD (`SoftwareApplication` + `AggregateOffer` + `FAQPage`) **derivado del
  mismo catálogo y del mismo FAQ** que la página renderiza, nunca escrito a mano
  en `index.html`: una copia estática del precio es libre de divergir de lo que
  se le pide pagar al visitante, que es lo único que un bloque de datos
  estructurados no puede hacer. Sin valoración agregada ni número de
  reseñas, porque no hay ninguna que reportar.

## Notas de implementación

- Checkout: formulario → `POST {VITE_API_URL}/public/licensing/checkout/create-session`
  (validado con Zod en el servidor) → redirección a `checkoutUrl` de Wompi.
  Sin `VITE_API_URL` configurado: error claro, no intento silencioso.
- Precios en vivo: `GET {VITE_API_URL}/public/plans`, semilla primero, swap
  silencioso, fallo = semilla. La procedencia se muestra en la banda de planes.
- CORS dev: el servidor permite `http://localhost:5173`; esta app corre en
  **5174 strictPort** → `CORS_ORIGIN=http://localhost:5173,http://localhost:5174`.
- Iconos: lucide vía better-icons CLI, SVG en línea con `currentColor`. El
  archivo `icons.tsx` solo contiene los glifos que la página usa.

### Componentes de terceros — veredicto

Búsqueda en catálogo (pricing cards, product reveal/bounce cards): todos
genéricos SaaS. La barra móvil, el borde rasgado, la especificación del
mostrador y el troquel se escribieron a mano. Esta landing no gana nada con
bloques stock; su valor está en la identidad documental propia.

## Pendientes del negocio (bloquean lanzamiento, no de diseño)

- Definir canal real de soporte/contacto y llenar `support.channel_email`.
- Confirmar nombre de marca (sigue siendo PuntoFarma provisional).
