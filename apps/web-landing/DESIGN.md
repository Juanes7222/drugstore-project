# PuntoFarma — Landing pública · Plan de diseño (dos pasadas)

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
| Display/UI | **Archivo** (variable, eje de ancho ~118–125 % para titulares) | Grotesca institucional de Omnibus-Type (fundición argentina): peso latinoamericano real, autoridad regulatoria sin serif cliché. Cuerpo también Archivo 400/500. |
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
| SaaS genérico (gradiente morado, Inter, mockup flotante) | Sin gradientes; Archivo Expanded; el mockup del hero es UI del dominio construida en HTML (carrito con lote ámbar y confirmación de fórmula), no captura genérica | OK |
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
