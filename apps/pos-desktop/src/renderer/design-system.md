# Design System — Pharmacy POS Terminal (apps/pos-desktop)

## Pass 1 — Design Brief

### Context

A pharmacy point-of-sale terminal for Colombian drugstores (droguerías). The cashier uses this eight hours a day scanning medications, verifying INVIMA lot/expiry data, confirming restricted-sale formulas, and processing split payments. The customer watches the screen during checkout. The system is offline-first: it keeps selling without internet and drains a sync queue when reconnected. Offline is a normal operating mode, not an error state.

---

### Palette — 6 hex values with domain rationale

| Name            | Hex       | Domain rationale |
|-----------------|-----------|------------------|
| **Pharma Teal** | `#0B6E6B` | Trust and brand. Deep teal sits between pharmaceutical blue (trust, sterility) and health green (care, wellness). Colombian pharmacy chains use blues and greens for their clinical associations. Used for primary actions, selected/focused states, and the brand mark. |
| **Urgency Amber** | `#E8780A` | Near-expiry / low-stock. An unambiguous "attention needed" signal that is not alarm-red. Sits between caution-yellow and danger-red — says "act soon" not "something broke." Used inline in product cards and cart rows for lots expiring within 30 days or stock below minimum threshold. Always paired with a text label; never relies on color alone. |
| **Sync Slate** | `#4A6572` | Offline-but-normal ambient state. Muted blue-gray that communicates "operating normally, just without connection right now." Calm, not alarming. Used in the ambient sync pulse signature element. Offline is a designed mode; the color must not imply failure. |
| **Restrict Violet** | `#5B3E96` | Restricted-sale confirmation. A deliberate visual break — this color appears only during the regulatory confirmation step for formula-controlled medications (antibiotics, opioids, benzodiazepines). It signals "stop, verify, and confirm" without implying error. Violet/indigo is associated with deliberation and regulatory authority in Colombian pharmaceutical culture; many INVIMA seals use similar tones. |
| **Surface Warm** | `#F9F6F0` | Background surface. A slightly warm off-white that avoids the clinical sterility of pure `#FFFFFF` or hospital green. Feels clean but human — a neighborhood drugstore counter, not an operating room. High contrast ratio against Data Ink text. |
| **Data Ink** | `#171614` | Primary text and data display. Near-black with a barely-perceptible warmth (not `#000000` which is harsh on eyes during 8-hour shifts). Used for prices, quantities, lot codes, and body text. Meets WCAG 2.1 AA 4.5:1 minimum contrast against Surface Warm. |

#### Functional color assignments (not new colors — roles assigned to palette entries above)

| Role | Color | Rationale |
|------|-------|-----------|
| Success / online / synced | Pharma Teal `#0B6E6B` | The resting state. Everything is normal. |
| Warning / near-expiry / low-stock | Urgency Amber `#E8780A` | Needs attention soon. Action required today or this week. |
| Offline / syncing | Sync Slate `#4A6572` | Normal operating mode without connectivity. Not an error. |
| Restricted / confirmation-required | Restrict Violet `#5B3E96` | Regulatory step. Cannot proceed without explicit confirmation. |
| Error / critical / discrepancy | `#D32F2F` (reserved — not in core palette) | True error states: shift discrepancy, sync conflict, print failure. Will be defined in a later phase when error patterns are designed. |

#### Supporting surface tints (added in Phase 2)

These are not new accent colors — they are muted versions of functional colors used only as background fills for badges, dialog panels, and inline alerts. They keep the restricted and urgency states accessible when used as large background areas.

| Name | Hex | Derived from | Usage |
|------|-----|--------------|-------|
| **Urgency Surface** | `#FFF3E5` | Urgency Amber at ~10% opacity | Background of near-expiry/low-stock badges and inline alerts. |
| **Restrict Surface** | `#F0EBFA` | Restrict Violet at ~10% opacity | Background of the restricted-sale confirmation dialog. |
| **Panel White** | `#FFFFFF` | Neutral | Cards, panels, dialogs, and the cart surface. |

---

### Type — two faces with domain justification

| Role | Family | Weights | Domain justification |
|------|--------|---------|---------------------|
| **UI / Display** | Inter | 400 (Regular), 500 (Medium), 600 (Semi Bold), 700 (Bold) | Workhorse sans-serif optimized for screen readability at small sizes (cashier scanning needs fast recognition at 14px). Tall x-height, open apertures, excellent hinting across platforms. Supports `tabular-nums` via OpenType features. Full weight range enables hierarchy without introducing a second UI face — one family, clearly differentiated roles. |
| **Data / Mono** | JetBrains Mono | 400 (Regular), 500 (Medium), 700 (Bold) | Purpose-built for legibility of code-like data: prices, quantities, barcodes, lot codes, INVIMA registration numbers. Tabular figures are the default (not opt-in), so columns of numbers align perfectly without extra CSS. Clear glyph distinction between confusable characters: `0` vs `O`, `1` vs `l` vs `I`, `5` vs `S` — critical for lot codes and barcode digits where a misread causes a dispensing error. |

#### Why this pairing

Both faces share a similar x-height and vertical rhythm, so they sit naturally beside each other in a cart row (product name in Inter, quantity × price in JetBrains Mono). Neither calls attention to itself — the numbers do the talking. Inter handles the human-readable; JetBrains Mono handles the machine-precise. At 13–16px on screen, both remain legible across an 8-hour shift.

Tabular figures are **non-negotiable** for any column of numbers: prices, quantities, subtotals, change amounts. JetBrains Mono provides them by default. Inter provides them via `font-variant-numeric: tabular-nums`. The token-reference page in this phase verifies both behave correctly.

---

### Layout — one sentence + ASCII wireframes per core screen

**One-sentence summary:** Every screen is framed by a persistent cash-shift header showing cashier name, opening balance, and elapsed time, with the main workspace below split between a product/catalog area (left 60%) and cart/transaction panel (right 40%) — navigation replaces the left panel content, the cart panel persists across screens during an active sale, and the ambient sync pulse runs full-width below the header on every screen.

#### Sales / Cart

```
┌──────────────────────────────────────────────────────────────┐
│ Turno: María Gómez  |  Apertura: $200.000  |  03:24 activo   │
│━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│ ← sync pulse (2px)
│                                                              │
│  ┌─────────────────────────┐  ┌────────────────────────────┐ │
│  │ [BUSCAR PRODUCTO...]    │  │  CARRITO (3 items)         │ │
│  │                         │  │                            │ │
│  │ Resultados:             │  │  Acetaminofén 500mg  ×2   │ │
│  │ ┌─────────────────────┐ │  │  $12.400                  │ │
│  │ │ Loratadina 10mg    │ │  │  Lote: L24056  V: 08/26   │ │
│  │ │ Stock: 45  $8.500  │ │  │                            │ │
│  │ └─────────────────────┘ │  │  Losartán 50mg  ×1  ⚠     │ │
│  │ ┌─────────────────────┐ │  │  $24.300  VENCE PRONTO    │ │ ← Urgency Amber inline
│  │ │ Ibuprofeno 400mg   │ │  │  Lote: IB-2411  V:15/07/26│ │
│  │ │ Stock: 3 ⚠  $6.200 │ │  │                            │ │
│  │ └─────────────────────┘ │  │  Clonazepam 2mg  ×1  🛡    │ │ ← Restrict Violet inline
│  │                         │  │  $18.900  VENTA RESTRINGIDA│ │
│  └─────────────────────────┘  │                            │ │
│                               │  Subtotal:     $55.600     │ │
│                               │  IVA (19%):    $10.564     │ │
│                               │  ─────────────────────     │ │
│                               │  TOTAL:        $66.164     │ │
│                               │                            │ │
│                               │  [COBRAR →]               │ │
│                               └────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

#### Payment

```
┌──────────────────────────────────────────────────────────────┐
│ Turno: María Gómez  |  Apertura: $200.000  |  03:28 activo   │
│━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
│                                                              │
│  TOTAL A PAGAR: $66.164                                      │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Método 1: [Efectivo ▼]    $40.000                      │ │
│  │ Método 2: [Tarjeta  ▼]    $26.164                      │ │
│  │ [+ Agregar método]                                     │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  Recibido: $50.000                                           │
│  Cambio:   $23.836    ← calculado automáticamente            │
│                                                              │
│  [Cancelar]              [Confirmar pago ✓]                  │
└──────────────────────────────────────────────────────────────┘
```

#### Receipt

```
┌──────────────────────────────────────────────────────────────┐
│ Turno: María Gómez  |  Apertura: $200.000  |  03:30 activo   │
│━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
│                                                              │
│  ✓ PAGO CONFIRMADO                       Factura #POS-00427  │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Droguería La Esperanza           NIT: 900.123.456-7    │ │
│  │ ─────────────────────────────────────────────────────── │ │
│  │ Acetaminofén 500mg ×2              $12.400             │ │
│  │ Losartán 50mg ×1                   $24.300             │ │
│  │ Clonazepam 2mg ×1                  $18.900             │ │
│  │ ─────────────────────────────────────────────────────── │ │
│  │ Subtotal:                          $55.600             │ │
│  │ IVA 19%:                           $10.564             │ │
│  │ TOTAL:                             $66.164             │ │
│  │ ─────────────────────────────────────────────────────── │ │
│  │ Efectivo: $40.000  Tarjeta: $26.164                    │ │
│  │ Cambio: $23.836                                         │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  [Imprimir]  [Enviar por email]  [Nueva venta]               │
└──────────────────────────────────────────────────────────────┘
```

#### Inventory Alerts

```
┌──────────────────────────────────────────────────────────────┐
│ Turno: Ana Torres  |  Apertura: N/A (sin caja) | En línea    │
│━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
│                                                              │
│  ALERTAS DE INVENTARIO                    [Filtrar: Todas ▼] │
│                                                              │
│  ⚠ Stock bajo (12 productos)                                 │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Ibuprofeno 400mg     Stock: 3   Mín: 10   [Pedir]      │ │
│  │ Loratadina 10mg      Stock: 5   Mín: 20   [Pedir]      │ │
│  │ Omeprazol 20mg       Stock: 8   Mín: 15   [Pedir]      │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ⏰ Próximo a vencer (8 productos, próximos 30 días)          │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Losartán 50mg     Lote: IB-2411   Vence: 15/07/26      │ │
│  │ Amoxicilina 500mg Lote: AM-2403   Vence: 22/07/26      │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  🛡 Restringidos (3 productos requieren verificación)          │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Clonazepam 2mg     Stock: 34    INVIMA: RS-2024-001     │ │
│  │ Tramadol 50mg      Stock: 12    INVIMA: RS-2023-892     │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

#### Admin

```
┌──────────────────────────────────────────────────────────────┐
│ Turno: Admin      |  Apertura: N/A          | En línea        │
│━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
│                                                              │
│  ADMINISTRACIÓN             [Usuarios] [Caja] [Sinc] [Conf]  │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Usuarios activos                                        │ │
│  │ ┌─────────────────────────────────────────────────────┐ │ │
│  │ │ Carlos Ruiz    Cajero      Turno activo: 02:15      │ │ │
│  │ │ María Gómez    Cajera      Turno activo: 03:10      │ │ │
│  │ │ Ana Torres     Inventario  En línea                  │ │ │
│  │ └─────────────────────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Cola de sincronización                                  │ │
│  │ ─────────────────────────────────────────────────────── │ │
│  │ ✓ Venta #POS-00425          07/07/26 02:58             │ │
│  │ ✓ Venta #POS-00426          07/07/26 03:05             │ │
│  │ ◷ Venta #POS-00427          07/07/26 03:12  (pending)  │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  [Abrir turno]  [Cerrar turno]        Estado: CONECTADO      │
└──────────────────────────────────────────────────────────────┘
```

---

### Signature Element — The Ambient Sync Pulse

A single 2px line spanning the full width of the application, positioned immediately below the cash-shift header and above all screen content. It has three states as an ambient background presence — never a badge, banner, or icon:

1.  **Online & synced (resting):** Pharma Teal `#0B6E6B`, static, opacity 0.6. Barely perceptible — like a heartbeat at rest. The cashier glances up and sees it there; they don't think about it.
2.  **Offline, queue building:** Transitions to Sync Slate `#4A6572`, develops a slow pulse animation (fade from 0.4 → 0.8 opacity and back over 3 seconds, `ease-in-out`). Communicates "we're in offline mode, everything is normal, items are queuing for later sync." Calm rhythm — the opposite of an alarm.
3.  **Reconnecting, queue draining:** Brightens slightly (Sync Slate at 0.7 → 1.0 opacity), pulse accelerates to 1.5s cycle, then upon full drain settles back to the resting Pharma Teal state with a subtle 400ms ease transition.

No other element in the application uses a full-width animated line. It is the single recurring visual element that ties the offline-first architecture to an always-visible affordance. Respects `prefers-reduced-motion`: when the user has reduced motion enabled, the pulse becomes a static color change with no animation.

**Why this cannot be pasted onto a generic CRM:** A CRM does not have an offline-first architecture with a sync queue that must drain after selling restricted medications offline with lot/expiry tracking. The Ambient Sync Pulse only makes sense in a system where offline operation with a queue is the normal mode — it is inherently pharmaceutical-POS-specific, not a decorative flourish.

---

### Component primitives (added in Phase 2)

These classes live in `styles/global.css` and are built entirely from the tokens above. They are the reusable surface/pattern vocabulary for every screen:

| Class | Purpose |
|---|---|
| `.pos-panel` | White card surface with the subtle POS panel shadow. Used for product results, cart, and dialog content. |
| `.pos-input` | Text input styled for dense POS use: 14px Inter, 4px radius, Pharma Teal focus ring. |
| `.pos-button-primary` | Pharma Teal background, white text. Used for the primary action on a screen (e.g., **COBRAR**). |
| `.pos-button-secondary` | White background, Data Ink text, subtle border. Used for secondary/cancel actions. |
| `.pos-badge-urgency` | Urgency Surface background, Urgency Amber text, uppercase label. For near-expiry and low-stock. |
| `.pos-badge-restrict` | Restrict Surface background, Restrict Violet text, uppercase label. For restricted-sale inline markers. |
| `.font-data` | Sets JetBrains Mono + `tabular-nums`. Required for every price, quantity, and total. |
| `.tabular-nums` | Sets `font-variant-numeric: tabular-nums` on any element. |
| `.sync-pulse-bar` | The signature 2px full-width line. States via `data-sync-state`. |

---

### Pass 2 — Self-Critique (conducted before any code was written)

#### Reject-list check

| Risk | Verdict |
|------|---------|
| Cream background + serif display + terracotta accent | **Pass.** Surface Warm is off-white with a barely-perceptible warmth, not cream. Type is sans-serif (Inter) for screen readability, not serif for marketing. Accent is teal, not terracotta/clay. |
| Purple-to-blue gradient SaaS sidebar | **Pass.** No sidebar exists in the layout. Navigation is top-tab or workspace-content, not a nav rail. No gradient. The only purple in the palette (Restrict Violet) is a functional regulatory state, not a decorative chrome color. |
| Unmodified shadcn/Tailwind starter reskin | **Pass.** Palette has domain-specific functional states (near-expiry, restricted-sale, offline-sync) that no starter ships with. The Ambient Sync Pulse is not in any starter. The cash-shift header frame is domain-specific. |
| Rounded-everything "Notion clone" | **Pass.** Data surfaces (cart table, receipt table, inventory lists) use minimal or zero rounding — they are working surfaces, not document cards. Interactive elements (buttons, search input) use subtle 4px radius. No shadow-everything cards with no hierarchy. |

#### Per-color critique

- **Pharma Teal:** Could a CRM use this? Superficially, yes — teal is a common brand color. But its role here is as a functional state indicator (online/synced/resting) in the sync pulse, not just a brand accent. A CRM would not have a teal sync pulse line because it wouldn't have an offline-first sync queue.
- **Urgency Amber:** A CRM doesn't have "near-expiry lot" or "stock below minimum for a medication" as a concept. This color's entire job is inline lot/expiry signaling — domain-specific.
- **Sync Slate:** A CRM doesn't have an ambient offline-state indicator because offline is an error in CRMs, not a normal mode. This color's job is to make "offline but fine" visible — domain-specific.
- **Restrict Violet:** A CRM doesn't have formula-controlled medication dispensing with INVIMA regulatory confirmation. This color exists solely for that confirmation step — domain-specific.
- **Surface Warm / Data Ink:** These two could theoretically be pasted onto a generic app, but that's acceptable — neutral surface and text colors must be transferable. The domain specificity comes from what they host, not from their hex values.

#### Type critique

Inter + JetBrains Mono is a pairing used in developer tools, but the justification here is domain-specific: tabular figures for price columns (every POS needs this), glyph distinction for lot codes (pharmacy-specific safety requirement), and 8-hour shift readability (cashier ergonomics). A CRM might use Inter but wouldn't need JetBrains Mono for tabular price alignment or lot-code glyph distinction — it would be an aesthetic choice, not a safety requirement.

#### Signature element critique

The Ambient Sync Pulse is the single committed signature element. It is not one of several small ideas spread thin — it is one clear, named, always-visible element that appears in every wireframe. It cannot be pasted onto a CRM, a hotel booking admin, or an e-commerce backoffice because those systems do not have an offline-first architecture with a sync queue for regulated pharmaceutical sales. It is inherently domain-specific.

#### Revisions made after Pass 2

1.  Originally considered a serif display face for the drugstore name on receipts — rejected as too marketing-like. The drugstore name uses Inter Bold instead; the identity comes from the content, not the typeface.
2.  Originally considered a separate "error red" in the core palette — deferred to a later phase. The core palette must cover the states a cashier sees every few minutes: trust, urgency, offline, restricted. True errors (shift discrepancies, print failures) are rarer and deserve their own design treatment later.
3.  Confirmed the sync pulse is the **only** recurring animated element. Removed a secondary idea about a cart badge animation — that would dilute the signature and add motion clutter to a high-throughput workflow.

---

## Sileo toast theming (added in Phase 5 — 2026-07-15)

Notifications are rendered by [Sileo](https://github.com/hiaaryan/sileo), a
physics‑based toast library. The `<Toaster>` is rendered once at the
`App.tsx` root and configured via CSS custom properties that map to the
core palette.

### Palette mapping

| Sileo state   | CSS var                  | Hex       | Domain role                          |
|---------------|--------------------------|-----------|--------------------------------------|
| `success`     | `--sileo-state-success`  | `#0B6E6B` | Pharma Teal — sale confirmed, synced |
| `error`       | `--sileo-state-error`    | `#D32F2F` | Reserved red — discrepancy, failure  |
| `warning`     | `--sileo-state-warning`  | `#E8780A` | Urgency Amber — low stock, expiring  |
| `info`        | `--sileo-state-info`     | `#4A6572` | Sync Slate — offline mode, syncing   |
| `loading`     | `--sileo-state-loading`  | `#4A6572` | Sync Slate — pending operation       |
| `action`      | `--sileo-state-action`   | `#5B3E96` | Restrict Violet — verification step  |

### Convenience API

Components and thunks call a typed `notify` utility rather than importing
`sileo` directly:

```ts
import { notify } from "@/utils/notify";

notify.success({ title: t("sales.complete") });
notify.error({ title: t("print.failed") });
notify.warning({ title: t("inventory.low_stock"), description });
notify.info({ title: t("sync.offline_queueing") });
notify.action({
  title: t("restricted.confirm"),
  action: { title: t("common.verify"), onClick: handleVerify },
});
notify.dismiss(id);
```

Each method pre‑configures a sensible default duration (4 s success/info,
6 s warning, 8 s error, persistent for loading/action). Pass `duration: null`
to make any toast persistent.

### Placement

The `<Toaster position="bottom-right" />` sits inside `<ServiceProvider>`
in `App.tsx`, so toasts are available on every screen including auth pages.
Bottom‑right keeps notifications clear of the cart panel (right 40%) and
the product search area (left 60%).

---

---

## Home Dashboard — Role-Based Landing Page (added 2026-07-17)

The Home screen replaces "sales" as the default post-login destination. It is a
role-aware dashboard that greets the user by name and surfaces the most relevant
actions and information for their role.

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Hola, María                               [Role: Cajera]         │
│  Listo para atender                                               │
│                                                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ 🛒 Nueva │ │ 🔄 Devol │ │ 📦 Invent│ │ 🔍 Buscar│            │
│  │   Venta  │ │          │ │          │ │          │            │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘            │
│                                                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────────┐ │
│  │ Stats    │ │ Shift    │ │ Sync     │ │ [ Nueva Venta ]     │ │
│  │ Ventas   │ │ —        │ │ Online   │ │ (CTA primary button) │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### Role sections

| Role | Quick Actions | Stats / Info |
|------|--------------|--------------|
| Cashier | New Sale, Return, Search Product | Today's sales count, shift status, sync status + CTA to start sale |
| Inventory Asst. | Inventory Adjustments | Low stock alerts, near-expiry count, pending adjustments |
| Manager / Owner | Users, Audit, Config, Sync | Active users, sync health, recent activity |
| Accountant | (same quick nav as manager) | Fiscal panel, sync status, DIAN status |
| Owner+ | All of the above | Full admin overview |

### Motion treatment

Per the motion budget, only the initial staggered entrance uses animation
(6 staggered groups, 60ms apart, 0.3s fade-up each). After that the Home
page has no periodic or decorative motion — it is a launchpad, not a
live-ticking dashboard. `prefers-reduced-motion` collapses all entrance
animations to opacity-only.

### Icon strategy

Every quick-action button uses a `lucide-react` icon (already a project
dependency). Icons are decorative (`aria-hidden="true"`) and use Pharma
Teal at 28px with `strokeWidth={1.5}` for a precise, non-heavy look.

---

## Audit — Timeline View (added 2026-07-18)

The audit log replaces the flat-table UX with a timeline of event cards, grouped
by day. This is the only screen that uses a timeline pattern — it is not the
default layout for any other view.

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Registro de auditoría                       12 eventos  [↻]    │
│                                                                  │
│  [Todos los eventos ▼] [Todos los módulos ▼] [Desde] [Hasta]    │
│                                                                  │
│  ── Hoy, 18 jul 2026 ────────────────────── 8 eventos ────────── │
│                                                                  │
│  ┃ ┌──────────────────────────────────────────────────────────┐ │
│  ┃ │ 🔐 Inicio de sesión                      hace 3 min      │ │
│  ┃ │ OWNER        Límite: 10 sesiones                         │ │
│  ┃ │ ▸ Token offline · Evictó sesión anterior                  │ │
│  ┃ └──────────────────────────────────────────────────────────┘ │
│  ┃ ┌──── expired: VER DETALLES ───────────────────────────────┐ │
│  ┃ │ 🔐 Inicio de sesión                      hace 12 min     │ │
│  ┃ │ OWNER                                                    │ │
│  ┃ │ ▸ Token offline · Evictó sesión anterior                  │ │
│  ┃ └──────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ← 1 / 5 →                      Mostrando 50 de 253 eventos     │
└──────────────────────────────────────────────────────────────────┘
```

### Color mapping per event category

| Category | Border color | Events |
|----------|-------------|--------|
| **Auth** | Pharma Teal `#0B6E6B` | AUTH_LOGIN_SUCCESS, AUTH_LOGOUT, ACCESS |
| **Failure** | Error `#D32F2F` | AUTH_LOGIN_FAILURE, ACCOUNT_LOCKED |
| **Security** | Restrict Violet `#5B3E96` | STEP_UP_AUTHORIZED, USER_ROLE_CHANGED, SESSION_REVOKED, AUTH_PASSWORD_CHANGED, AUTH_PIN_RESET |
| **Users** | Sync Slate `#4A6572` | USER_CREATED, USER_DISABLED |
| **Inventory** | Urgency Amber `#E8780A` | All INVENTORY_* events |

The color is rendered as a 3px-left border on the event card. No other element
in the audit view uses these colors outside their designated category — the
border is the sole category indicator.

### Event card anatomy

1. **Left border** — 3px, category color per table above.
2. **Icon row** — Event-type icon (lucide-react: `LogIn`, `LogOut`, `Shield`,
   `Package`, `AlertTriangle`, `UserPlus`, `UserX`, `Lock`) + translated event
   name in semibold 14px + relative timestamp right-aligned in caption 12px
   muted.
3. **Actor row** — Role badge (small, uppercase, capsule style) + user ID if
   role alone is generic.
4. **Detail summary** — 1-2 lines of parsed JSON rendered as human-readable
   key-value pairs (e.g., "Token offline emitido · Límite: 10 sesiones ·
   Vence: 01/08/2026"). Only the 2-3 most important fields shown; full JSON
   available via expand toggle.
5. **Target** — Only shown when target is meaningful (not "unknown:unknown" or
   empty). Rendered as a muted label below details: e.g., "Producto:
   Ibuprofeno 400mg · Lote: IB-2411".

### Expand/collapse for JSON details

- **Collapsed (default)**: Shows the human-readable detail summary only.
- **Expanded**: Reveals a `<pre>` block in `font-data` (JetBrains Mono) with
  the full formatted JSON, syntax-highlighted via className `text-caption` and
  a subtle background tint. Toggle is a text button "Ver detalles" /
  "Ocultar detalles" in caption 12px.
- Keyboard: Enter/Space toggles expand on focused card.

### Empty state

When no events match filters:
- Centered icon (from `SearchX` lucide icon) in muted ink
- "No se encontraron eventos para los filtros seleccionados"
- Secondary text: "Intenta ajustar las fechas o cambiar el tipo de evento"

### Motion treatment

- **Entrance**: No animation. The audit view is a reference screen, not a
  high-throughput transaction screen — but also not a celebratory moment
  worthy of orchestrated motion. Cards appear immediately on load/filter
  change. `prefers-reduced-motion` not applicable (no animations).
- **Expand**: 200ms height transition on detail panel, opacity 0→1 on the
  JSON pre block. This is a functional expansion, not a decorative one.
  Respects `prefers-reduced-motion`: collapses to instant show/hide.

### Accessibility

- Day group headers are `<h2>` elements for proper document outline.
- Event cards are `<article>` elements with `aria-label` describing the event.
- Expand toggle is a `<button>` with `aria-expanded`.
- Filter selects are labeled via `aria-label`.
- Pagination buttons are labeled via `aria-label="Página anterior"` /
  `aria-label="Página siguiente"`.
- Color is never the sole differentiator: the left border is paired with the
  icon and event-type label.

---

## Motion budget (added in Phase 3)

Motion is reserved for the sale-completing handoff, not for the high-throughput search/scan/add-to-cart path.

- **Search, scan, add-to-cart, and payment entry:** No orchestrated animation. Feedback is a single crisp state change (button press, input update, status badge).
- **Sale completion:** A coordinated two-screen transition. Payment initiates the exit choreography and sets the `saleCompletionPhase` to `"initiating"`. After the initiating beat, control passes to Receipt via `"completing"`, where Receipt plays the entry choreography and dispatches `"completed"`. `prefers-reduced-motion` collapses both phases to an opacity-only or instant transition.
- **Card/transfer authorization pending state:** A small CSS spinner inside the status badge is acceptable because it is a local, functional loading indicator, not a decorative flourish.

---

## Client selector (added 2026-07-17)

A searchable dropdown for selecting a client during a sale, composed in the
cart panel. Behaviour depends on the tenant config's `clientRequired` field:

| Config value   | Component behaviour                          |
|----------------|----------------------------------------------|
| `ALWAYS`       | Prominent search visible, pharma teal border |
| `ABOVE_AMOUNT` | Same as ALWAYS when total ≥ threshold        |
| `NEVER`        | Hidden entirely                              |

### States

1. **Collapsed (no client selected):** Dashed-border button reading "Cliente
   (opcional)" or "Cliente requerido para esta venta" depending on config.
2. **Search open:** Input with icon, results dropdown below, keyboard
   navigable (ArrowUp/Down/Enter/Escape).
3. **Client selected:** Compact chip with user icon, client name + ID, and
   an × button to clear.
4. **Empty results:** "No se encontraron clientes" message.
5. **Loading:** "Cargando..." message in result area.

### Integration

- Reads `ClientsService` from service context (domain layer).
- Reads `clientRequired` field requirement from `useFieldRequirementFor()`.
- Dispatches `setClient` / `clearCart` on Redux `sales-slice`.

---

## Help bar (added 2026-07-17)

A low-visibility strip below the search input that exposes three keyboard
shortcuts as clickable buttons:

| Button      | Shortcut | Action                          |
|-------------|----------|---------------------------------|
| Command     | ⌘K       | Opens command palette           |
| Help        | F1       | Contextual help for current screen |
| Shortcuts   | ?        | Opens shortcut cheatsheet       |

Styled at `12px` (caption size) with muted ink at 45% opacity. Uses the
`assistant.store` Zustand store directly to call overlay actions. Always
visible on the sales screen — designed to be ignorable during fast scanning
but discoverable when needed.

---

## "Added to cart" confirmation (added 2026-07-17)

When a cashier clicks a product in search results, the card briefly shows
an "AGREGADO" badge (pharma teal, uppercase, 1.2s) and a subtle scale-down
(`scale(0.99)`) before returning to normal. This gives tactile confirmation
that the item entered the cart without requiring a toast or modal — both
would interrupt the high-throughput scan rhythm.

### Motion treatment

- Entry: 200ms ease-out (badge opacity + card border color).
- Exit: 200ms ease (badge opacity → 0).
- No animation on keyboard-initiated selection (respects Emil's principle
  that keyboard actions at 100+/day should be instant).
- Respects `prefers-reduced-motion`: only the opacity transition remains,
  no scale/border change.
