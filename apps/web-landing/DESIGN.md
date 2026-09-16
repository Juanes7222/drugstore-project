# PuntoFarma — Landing pública · Plan de diseño (dos pasadas)

> **Pasada de rediseño de septiembre de 2026** (experiencia de usuario y
> movimiento): el catálogo de identidad no cambia; esta pasada lo hace más
> dinámico y menos saturado. Resumen de lo añadido y por qué, al final del
> documento, en «Revisión de septiembre de 2026».

> **PuntoFarma es un nombre de marca provisional.** El repo no define nombre de
> producto; se centralizó en `src/i18n/locales/es.json` (`brand.name`) y en el
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

## Pasada 1 — Brief

### Paleta (5 valores nombrados)

| Token | Hex | Por qué |
| --- | --- | --- |
| `verde-cruz` | `#0F6B3F` | Verde farmacia profundo: confianza sanitaria, la cruz verde del barrio. Acciones primarias, marca. |
| `tinta` | `#15221B` | Tinta con base verde en vez de negro neutro: toda la página vive "en el mundo" de la droguería. Texto y panel oscuro. |
| `papel` | `#F7F8F5` | Blanco papel FRÍO (no crema #F4F1EA): superficie limpia de documento fiscal. Fondo base. |
| `menta` | `#DFEDE4` | Tinte verde pálido: superficies destacadas, bloque DIAN, chips. |
| `ambar-lote` | `#B45309` + fondo `#FBEEDD` | Único color de urgencia del dominio (lote por vencer). Aparece UNA vez, dentro del preview del POS. Nunca decorativo. |

Bordes/rayas derivados de `tinta` al 12–18 % de opacidad — como tinta de
impresora sobre papel, no grises genéricos.

### Tipografía

| Rol | Fuente | Uso |
| --- | --- | --- |
| Display/UI | **Archivo** (variable, ancho natural; sin eje de ancho cargado) | Grotesca institucional de Omnibus-Type (fundición argentina): peso latinoamericano real, autoridad regulatoria sin serif cliché. Cuerpo también Archivo 400/500. |
| Datos | **IBM Plex Mono** 400/500/600 | TODO número que importa: precios COP, lotes, NIT, fechas, folios, colas de sincronización. Monoespaciada = voz de recibo/factura, dígitos tabulares por naturaleza. |

Regla dura: **ningún peso aparece fuera de Plex Mono.** Si es dinero o dato
fiscal, va en mono.

### Layout

Una sola columna narrativa, secciones anchas generosas, pocas líneas divisorias
(cada regla que existe delimita una tabla de documento real):

```
┌────────────────────────────────────────────────────────────┐
│ ◆ PuntoFarma        Producto Planes FAQ   [Comprar]        │ ← header fino fijo
├────────────────────────────────────────────────────────────┤
│ POS PARA DROGUERÍAS COLOMBIANAS            ┌─────────────┐ │
│ La caja que no se detiene                  │ POS REAL    │ │
│ cuando se va internet.                     │ (HTML/CSS:  │ │
│ [Comprar licencia]  [Ver planes]           │ carrito,    │ │
│ ✓ DIAN ✓ INVIMA ✓ Offline                  │ lote ámbar) │ │
│                                            └─────────────┘ │
├────────────────────────────────────────────────────────────┤
│ 4 pilares: escaneo+lotes · fórmulas · turno · sync         │
├────────────────────────────────────────────────────────────┤
│ ███ PANEL OSCURO (tinta)                                   │
│ Se fue internet. La caja sigue abierta.                    │
│ cola local drenándose (mono, calma — no rojo)              │
└────────────────────────────────────────────────────────────┘
├────────────────────────────────────────────────────────────┤
│ PLANES  [Mensual|Trimestral −10%|Anual −20%]               │
│ ┌── documento fiscal ──┐  ┌── documento fiscal ──┐         │
│ │ PROVIDER             │  │ CERTIFICATE          │         │
│ │ idéntico salvo →     │  │ ← bloque DIAN        │         │
│ │ [bloque DIAN menta]  │  │   resaltado          │         │
│ │ Total $199.000/mes   │  │ Total $199.000/mes   │         │
│ └──────────────────────┘  └──────────────────────┘         │
│ nota: 3 puestos incluidos · extra $40.000 · máx 5/sede     │
├────────────────────────────────────────────────────────────┤
│ Cómo empieza: 1 Compra → 2 Código por email → 3 Activa     │
├────────────────────────────────────────────────────────────┤
│ FAQ (acordeón)                                             │
├────────────────────────────────────────────────────────────┤
│ Banda final CTA · Footer legal (Términos · Privacidad ·    │
│ Ley 1581)                                                  │
└────────────────────────────────────────────────────────────┘
```

Rutas legales: `/terminos`, `/privacidad`, `/datos-personales` (un solo
`LegalPage` con contenido por documento).

### Firma

**Los planes como dos documentos fiscales gemelos que "se imprimen".**
Cada plan se presenta como un comprobante (encabezado de documento, tabla de
conceptos en mono, borde perforado inferior) y ambos entran con una animación
de impresión (`clip-path` de arriba hacia abajo, escalonada) al entrar en
pantalla. Y la decisión estructural que nadie más toma: **las dos tarjetas son
idénticas en todo menos en el bloque DIAN resaltado**, porque eso es
exactamente lo que los diferencia en el sistema. La honestidad ES el diseño.

Momento de movimiento orquestado único: la impresión de esos documentos.
Todo lo demás queda quieto o casi.

### Movimiento (presupuesto, estilo Emil)

- Presión de botón: `scale(0.97)` / 160 ms ease-out. Hovers gated tras
  `@media (hover:hover)`.
- Acordeón FAQ: transición de grid rows `0fr→1fr` 200 ms ease-out
  (interrumpible, sin keyframes).
- Impresión de documentos: 900 ms `cubic-bezier(0.23,1,0.32,1)`, una sola vez
  (IntersectionObserver `once`). Segundo documento +150 ms.
- Entrada del hero: stagger fade-up ≤300 ms, delays 30–60 ms.
- Nada más se mueve. `prefers-reduced-motion`: impresión→fade, stagger→0,
  scroll suave off.

---

## Pasada 2 — Crítica contra defaults

| Riesgo default | Veredicto | Ajuste hecho |
| --- | --- | --- |
| Crema + serif + terracota | Papel frío `#F7F8F5` (no crema), cero serif | Elegido deliberadamente lejos del cluster |
| Casi-negro + verde ácido | Panel oscuro único (sección offline), verde farmacia media saturación, no neón | OK |
| Broadsheet hairlines + radio 0 | Reglas solo donde hay tabla real; radios moderados (docs 10px, botones 6px); aire generoso | OK |
| SaaS genérico (gradiente morado, Inter, mockup flotante) | Sin gradientes; Archivo a ancho natural; el mockup del hero es UI del dominio construida en HTML (carrito con lote ámbar y confirmación de fórmula), no captura genérica | OK |
| Marcadores numerados decorativos | Numeración SOLO en los 3 pasos de compra (secuencia verdadera) | OK |
| Pricing SaaS con tiers inventados | Dos documentos gemelos que difieren en UN campo, igual que el sistema | Es el riesgo estético asumido y justificado |

Copys: español, sentence case, verbos llanos, activa ("Comprar licencia",
no "Enviar"). Errores del checkout explican qué pasó y cómo seguir; sin
disculpas ni vaguedades. Nada promete prueba gratis (el sistema no la siembra).

## Notas de implementación

- Checkout: formulario → `POST {VITE_API_URL}/public/licensing/checkout/create-session`
  (Zod validado server-side) → redirección a `checkoutUrl` de Wompi.
  Sin `VITE_API_URL` configurado: error claro, no intento silencioso.
- CORS dev: servidor permite por defecto solo `http://localhost:5173`; esta app
  corre en **5174 strictPort** → documentar `CORS_ORIGIN=http://localhost:5173,http://localhost:5174`.
- Iconos: lucide vía better-icons CLI, inline SVG stroke `currentColor`,
  paths normalizados sin `fill` heredado.

---

## Revisión de agosto de 2026 — rediseño de copy y cierre de conversión

Segunda pasada sobre el sitio ya implementado, con tres focos: voz humana,
información que falta y momentos finales de conversión. La paleta, la
tipografía y la firma (documentos fiscales) no cambian; se extienden.

### Voz (regla para todo copy nuevo)

Escribir como le hablaría un asesor de confianza a la dueña de una droguería:
frases cortas, consecuencias concretas en vez de listas de funciones, cero
jerga de software («sincronización», «multi-sede» solo si aporta). Mal:
«PuntoFarma escanea, controla lotes…» (volcado de especificación). Bien:
«Lo que está por vencer se marca antes de facturar, no después del reclamo.»

Cambios aplicados: subtítulo del héroe reescrito desde la consecuencia;
«Sincronización sola» → «Se sincroniza solo»; FAQ fusionó pago+cancelación
(en los términos son una sola respuesta) y sumó «¿Cómo funciona el
soporte?»; pasos de compra con expectativas realistas (sin SLA inventado).

### Información nueva (y lo que NO se inventó)

- Cada pilar lleva una línea `data` en mono con un artefacto real del POS
  (lote por vencer, turno #38, cola en 0) — prueba concreta, no adjetivo.
- Canal de contacto: **no existe** correo/WhatsApp real en el repo, así que
  NO se inventó dirección. Quedó el slot `support.channel_email` (vacío):
  mientras no tenga valor, el footer no renderiza nada. Pendiente del negocio.
- Nada promete importación de inventario ni tiempos de entrega: el sistema
  aún no los documenta; prometerlos sería mentir en una página de ventas.

### Extensiones de diseño

1. **La tirilla final (CTA band).** El cierre ya no es una caja verde
   genérica: es un recibo térmico blanco con perforación inferior sobre el
   verde farmacia, filas en mono (sedes, DIAN·INVIMA·offline, soporte,
   período), total grande y el botón dentro del documento. Respeta el total
   del período escogido arriba (misma fórmula del servidor). Reutiliza el
   reveal de impresión — tercera aparición, misma firma.
2. **Drenaje de la cola (offline).** Al entrar en pantalla, las líneas de la
   cola aparecen escalonadas (160 ms) después del panel — la frase «la cola
   sube sola» contada con movimiento, no con prosa. Transiciones CSS
   disparadas por el mismo `data-printed`; reduced motion → fade corto.
3. **Barra de compra móvil.** Fija abajo, aparece cuando el héroe sale de
   vista (`threshold: 0.9`, IO), cita el equivalente mensual del período
   activo. `md:hidden`; entra deslizando 260 ms ease-out (transición, no
   keyframe); respeta safe-area iOS.

### Detalles Emil aplicados

- Flecha de CTAs primarios: `translateX(2px)` al hover, gated a
  `(hover:hover) and (pointer:fine)`.
- Todo lo nuevo usa transiciones retargeteables (barra, cola) o el reveal
  existente; ningún keyframe nuevo salvo los ya presentes.
- Duraciones ≤ 300 ms salvo los reveals tipo impresión (900 ms, una vez).

### Componentes de terceros — veredicto

Búsqueda en catálogo (pricing cards, product reveal/bounce cards): todos
genéricos SaaS; ninguno supera los documentos fiscales propios. La barra
móvil se escribió a mano (~60 líneas) en vez de adoptar un bloque ajeno.
Conclusión: esta landing no gana nada con bloques stock; su valor está en la
identidad fiscal propia.

### Pendientes del negocio (bloquean lanzamiento, no de diseño)

- Definir canal real de soporte/contacto y llenar `support.channel_email`.
- Confirmar nombre de marca (sigue siendo PuntoFarma provisional).

---

## Planes en vivo desde el servidor (mismo día, segunda revisión)

La sección de planes ya no depende solo de la semilla: consume
`GET {VITE_API_URL}/public/plans` (endpoint público existente en
`plans.controller.ts`, filas Prisma ordenadas por `displayOrder`).

### Patrón elegido: cached-first, no skeleton

- **Primer pintado:** catálogo semilla (`SEED_PLANS`, misma fuente del
  servidor) al instante — la página nunca espera red ni muestra esqueletos.
- **Intercambio silencioso:** cuando la respuesta pasa la validación Zod
  (`PublicPlansResponseSchema`, 8 s de timeout), el store
  (`stores/plans-store.ts`) reemplaza los planes en sitio. Sin layout shift.
- **Falla = semilla, nunca error:** sin `VITE_API_URL`, red caída, respuesta
  malformada o catálogo vacío → siguen los precios de referencia. Una página
  de ventas no se rinde ante un timeout.
- **Procedencia visible:** línea mono con punto de estado sobre los documentos
  (`role="status"`, anunciado amablemente): «Precios verificados contra el
  servidor · HH:mm» en verde, o «Precios de referencia» en tinta apagada.
  Coherente con la honestidad fiscal del resto del sitio.

### Cambios de visualización aprovechando datos vivos

- Cada documento muestra ahora la `description` del plan (difiere entre los
  gemelos: es la única prosa propia de cada uno).
- La cuadrícula acepta N planes (si administración publica un tercero, entra
  sin cambios de código).
- Checkout dialog, tirilla final y barra móvil leen del mismo store — un solo
  precio mostrado en toda la página, siempre consistente.

### Archivos

- Nuevos: `lib/public-plans-api.ts` (fetch + Zod), `stores/plans-store.ts`
- Modificados: `data/plans.ts` (`PUBLIC_PLANS` → `SEED_PLANS` + descripción),
  `pricing.tsx`, `plan-document.tsx`, `cta-band.tsx`, `mobile-buy-bar.tsx`,
  `checkout-dialog.tsx`, `App.tsx`, `es.json`, `.env.example`
- Dependencia nueva: `zod@^4` (validación de la respuesta; regla del repo)

---

## Revisión de septiembre de 2026 — movimiento, ritmo y menos texto

Tercera pasada, pedida por el cliente: «más profesional, más intuitivo, más
bonito, menos texto saturante, buena experiencia de usuario, con efectos,
movimientos y animaciones». La identidad (paleta, tipografía, firma fiscal)
no cambia: lo que cambia es el ritmo — la página ahora respira, revela y
responde.

### Presupuesto de movimiento (regla dura)

Como máximo dos loops ambientales a la vista, todo lo demás dispara una vez:

- **Reveals de scroll** (`.reveal` + `useReveal`): fade-up 500 ms una vez,
  stagger 70 ms por índice. En pilares, offline, planes, pasos, FAQ, notas.
  Gateado con `html[data-js]` — sin JS no hay contenido escondido.
- **Cinta fiscal** (`Ticker`): los datos reales del POS (lote por vencer,
  fórmulas, turno, cola) desfilan bajo el héroe como cinta de estado, 36 s
  por vuelta, pausa al hover. Es la respuesta de diseño a «menos texto»: el
  texto que queda demuestra que el sistema está vivo. Bucle duplicado −50 %
  para el loop perfecto; `sr-only` recibe el resumen.
- **Terminal vivo** (`PosPreview`): scanline que barre el mockup una vez por
  ciclo (5.5 s, ~40 % activo), el glyph de escaneo cambia de tono y el glyph
  de sync gira 90° en el mismo ciclo — el mockup se lee como máquina
  encendida, no como captura muerta.
- **Precios que ruedan** (`useAnimatedAmount` + `AnimatedPrice`): al cambiar
  el período, el total hace tween 420 ms ease-out-cubic en centavos
  enteros (sin artefactos de formato). Aplica a los dos documentos y a la
  tirilla final. Reduced motion: cambio instantáneo.
- **Barra de progreso de lectura** en el header: 2 px verde fiscal,
  `scaleX` con scroll pasivo — orientación silenciosa en un pitch largo.
- **Pulso único** (`pulse-dot`): el punto verde de «precios verificados» y
  la venta «en cola» laten 2.4 s. Un latido por zona, nunca dos a la vez.
- **Hover disciplinado**: `card-lift` (translateY −3px + sombra) en las
  tarjetas de pilares, indent de 4 px en preguntas FAQ. Todo gated a
  `(hover:hover) and (pointer:fine)`.
- **Ambient del héroe**: campo radial verde detrás del terminal + cruz de
  farmacia delineada flotando 10 px (7 s alternate, opacidad 0.09). Estático
  para reduced motion.
- **Reglas de pasos**: el acento verde se dibuja (width 0→3.5rem) cuando el
  paso entra en pantalla — los números son secuencia real, la regla lo
  cuenta.

`prefers-reduced-motion` apaga: ticker, scanline, scan-flash, sync-spin,
pulse-dot, hero-float, y convierte reveals y tweens en fades cortos o
saltos directos. Nada de `@keyframes` nuevos fuera de global.css.

### Menos texto (qué se recortó y qué NO)

- Subtítulo del héroe, subtítulo de planes, cuerpo offline y los tres pasos
  se reescribieron más cortos. Se recortó promoción, nunca información:
  precios, DIAN, lotes, Wompi y cancelación quedan intactos.
- La cinta fiscal absorbe la carga de «prueba» que antes llevaban párrafos:
  los datos en mono dicen más que dos líneas de prosa.
- Los pilares pasaron de texto suelto a tarjetas blancas con borde y su
  línea `data` como pie de ficha — escaneo en F, menos carga cognitiva.

### Archivos

- Nuevos: `hooks/use-reveal.ts`, `hooks/use-animated-amount.ts`,
  `components/reveal.tsx`, `components/animated-price.tsx`,
  `components/ticker.tsx`, ícono `PlusIcon`.
- Modificados: `global.css` (sistema de movimiento), `site-header.tsx`,
  `hero.tsx`, `pos-preview.tsx`, `pillars.tsx`, `offline-panel.tsx`,
  `pricing.tsx`, `plan-document.tsx`, `steps.tsx`, `faq.tsx`, `cta-band.tsx`,
  `App.tsx`, `es.json` (claves `ticker.*` + copys cortos).

---

## Tipografía: títulos a ancho natural (mismo día)

El cliente sintió los titulares «estirados». Se elimina `font-stretch: 118%`
de `.display` y la carga del eje variable de ancho (`wdth 62..125`) de
Archivo en Google Fonts — los titulares quedan en su ancho de diseño
natural, y el CSS de la fuente baja de peso. La identidad (grotesca
institucional + Plex Mono para datos) no cambia.

---

## Auditoría UX de septiembre de 2026 (post-rediseño)

Revisión sistemática contra una lista de reglas UX por prioridad
(accesibilidad → touch → performance → animación → formularios → navegación).
Todo verificado con typecheck + build. Hallazgos y correcciones:

| # | Regla violada | Corrección |
| --- | --- | --- |
| 1 | Skip link ausente | «Saltar al contenido» visible al foco; objetivo `#contenido` en `<main>` y en legales |
| 2 | Contraste: disclaimer `papel/40` (3.6:1) | Subido a `papel/60` (>4.5:1) |
| 3 | Contraste: chip ámbar 11 px (4.39:1) | Token nuevo `--color-ambar-lote-texto` `#92400e` (≈6:1) |
| 4 | Touch target: `.btn-sm` ~36 px | `min-height: 2.75rem` (44 px) en `.btn` y `.btn-sm`; inputs del checkout `min-h-11` |
| 5 | `cursor: default` en botones | `cursor: pointer` + `touch-action: manipulation` en `.btn` |
| 6 | Perf: barra de progreso re-renderizaba React por evento scroll | Escritura directa de `transform` dentro de rAF, sin setState |
| 7 | Perf: scanline animaba `top` | Track de altura completa movido solo con `transform: translateY` |
| 8 | `excessive-motion`: 4 loops en el primer viewport | Cruz del héroe estática (cinta + ciclo de máquina bastan) |
| 9 | Anchors bajo header sticky | `scroll-mt-16/24` en `#producto`, `#planes`, `#faq` |
| 10 | Barra móvil tapaba el footer | Footer con `pb-28 md:pb-14` |
| 11 | `nav-state-active` ausente | Scrollspy con IntersectionObserver + `aria-current` |
| 12 | Formularios: «Revise los campos marcados» sin marcar nada | `noValidate` + errores por campo bajo el input, `aria-invalid`, `aria-describedby`, focus al primer inválido, borde error, required `*` |
| 13 | «≈ al mes» saltaba seco al cambiar período | Rolling con `useAnimatedAmount` (hook a nivel superior, Rules of Hooks) |
| 14 | `<head>` sin theme-color ni OG | `theme-color #F7F8F5` + og:title/description/locale |
| 15 | Medida de línea FAQ >75 caracteres | `max-w-3xl` + `min-w-0` en preguntas |

Sin regressiones conocidas: la firma (documentos fiscales), la fórmula de
precios y el fallback semilla siguen intactos.

