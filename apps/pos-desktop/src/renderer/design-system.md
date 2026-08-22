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

### SyncAttentionBanner (redesigned 2026-07-28)

The banner now has three tiers, only one visible at a time (highest priority wins):

| Priority | Variant | Trigger | Color | Icon | Tone |
|----------|---------|---------|-------|------|------|
| 1 (highest) | `backup_critical` | `backupHealth === "CRITICAL"` | Error red | TriangleAlert | Urgent — contact admin |
| 2 | `permanent_failure` | `permanentFailure > 0` | Urgency Amber | AlertTriangle | Warning — some items failed permanently |
| 3 | `pending` | `pending > 0` | Sync Slate | Clock | Calm info — items waiting to sync |

Previously the banner showed `stalePending > 0` (items PENDING > 1h) as an amber alert. This was too aggressive for an offline-first POS where pending items are normal. Changed:
- Pending items now show as calm Sync Slate info, not as an amber alert.
- Only `permanentFailure` (items that exhausted retries) triggers a warning.
- The old `contact_manager` key was removed — permanent failures now point to admin directly.

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

## Audit — Timeline View (added 2026-07-18, redesigned 2026-07-22)

The audit log is a timeline of event cards grouped by day. This is the only
screen that uses a timeline pattern.

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Registro de auditoría                           [ℹ] [↻]         │
│  Todos los eventos del sistema ordenados por fecha               │
│                                                                  │
│  [ℹ Leyenda de categorías — togglable]                           │
│                                                                  │
│  [🔍 Todos los eventos ▼] [Todos los módulos ▼] [📅 Desde][—][Hasta] [✕ Limpiar] │
│                                                                  │
│  ── HOY ────────────────────────────────── 8 eventos ────────── │
│                                                                  │
│  ┃ ┌──────────────────────────────────────────────────────────┐ │
│  ┃ │ 🔐 Inicio de sesión       [Usuarios]        hace 3 min   │ │
│  ┃ │ maria.gomez  [DUEÑO]                                     │ │
│  ┃ │ Conexión sin internet · Vence: 01/08/2026                 │ │
│  ┃ │ ▸ Ver detalles                                            │ │
│  ┃ └──────────────────────────────────────────────────────────┘ │
│  ┃ ┌──────────────────────────────────────────────────────────┐ │
│  ┃ │ ⚠ Intento fallido                           hace 12 min  │ │
│  ┃ │ carlos.r  [CAJERO]                                       │ │
│  ┃ │ Motivo: Contraseña incorrecta                             │ │
│  ┃ │ ▸ Ver detalles                                            │ │
│  ┃ └──────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Mostrando 50 de 253 eventos     ← 1 / 5 →                      │
└──────────────────────────────────────────────────────────────────┘
```

### Color mapping per event category

Full legend shown in a togglable panel below the header:

| Category | Border color | Events |
|----------|-------------|--------|
| **Auth** | Pharma Teal `#0B6E6B` | AUTH_LOGIN_SUCCESS, AUTH_LOGOUT, ACCESS, OFFLINE_LOGIN |
| **Failure** | Error `#D32F2F` | AUTH_LOGIN_FAILURE, ACCOUNT_LOCKED, OFFLINE_SESSION_REJECTED |
| **Security** | Restrict Violet `#5B3E96` | STEP_UP_AUTHORIZED, USER_ROLE_CHANGED, SESSION_REVOKED, AUTH_PASSWORD_CHANGED, AUTH_PIN_RESET |
| **Users** | Sync Slate `#4A6572` | USER_CREATED, USER_DISABLED |
| **Inventory** | Urgency Amber `#E8780A` | All INVENTORY_* events |
| **Network** | Network Blue `#1565C0` | LOCAL_SYNC_HUB_ELECTION, LOCAL_SYNC_CONFLICT, LOCAL_SYNC_PUSH, LOCAL_SYNC_PULL |
| **Cash Shift** | Cash Green `#2E7D32` | CASH_SHIFT_OPENED, CASH_SHIFT_CLOSED, CASH_SHIFT_FORCED_CLOSE, CASH_COUNT_PARTIAL |
| **Sale** | Dark Teal `#00897B` | SALE_CONFIRMED, SALE_ANNULLED |
| **Client** | Blue-Grey `#546E7A` | CLIENT_CREATED, CLIENT_UPDATED, CLIENT_DEACTIVATED |
| **Prescription** | Purple `#7B1FA2` | PRESCRIPTION_REGISTERED |
| **Purchase** | Deep Orange `#E65100` | PURCHASE_ORDER_CREATED, PURCHASE_RECEPTION_CONFIRMED |
| **Fiscal** | Dark Blue `#0D47A1` | FISCAL_INVOICE_EMITTED, FISCAL_CONTINGENCY_ACTIVATED |
| **Default** | Grey `#D4D2CC` | Unknown/unclassified events |

### Event card anatomy

1. **Left border** — 3px, category color.
2. **Icon row** — Event-type icon (varied lucide-react icons per event type) +
   translated event name in semibold 14px + module badge (muted pill) + relative
   timestamp right-aligned in caption 12px.
3. **Actor row** — User ID in `font-data` + translated role badge (e.g. "Dueño",
   "Cajero", "Contador") using `translateRole()` helper — NEVER raw English
   role strings. Role badges use `bg-ink/8` by default; per-role semantic colors
   are defined in user-management.helpers.ts.
4. **Detail summary** — 1-2 lines of human-readable fragments with inline dots.
   Terminology uses plain Spanish: "Conexión sin internet" (not "Token offline"),
   "Clave criptográfica v{{version}}" (not "CVK v{{version}}"), "Sesión anterior
   cerrada" (not "evictada").
5. **Target** — Only when meaningful (not "unknown:unknown" or empty). Muted
   caption below details: e.g., "Producto: Ibuprofeno 400mg · Lote: IB-2411".

### Expanded detail panel

- Replaced the old `<pre>` block with a 2-column grid of parsed key-value pairs.
- All known fields are translated to readable Spanish.
- Unknown fields render with a translated label via `translateUnknownKey()` map:
  `ipAddress → "Dirección IP"`, `userAgent → "Navegador"`, etc.
- Toggle uses `ChevronDown`/`ChevronRight` instead of `Eye`/`EyeOff`.

### Category legend

- Togglable panel below the header showing all 13 categories with their color
  swatch and translated name.
- Activated via a button with `Info` icon in the header bar.

### Loading state

- 5 animated skeleton cards with `animate-pulse` that mimic the event card shape.
- Replaces the old plain text "Cargando..." message.

### Empty states

Two distinct empty states:
1. **No events at all** (`!hasActiveFilters`): Large `SearchX` icon with
   "No hay eventos" + hint text.
2. **No results for active filters** (`hasActiveFilters`): Same visual layout
   with "No se encontraron eventos para los filtros seleccionados" + hint.
   A "Clear filters" button with `X` icon is always visible when filters are
   active.

### Role gate

When the user lacks MANAGER role:
- Centered `Info` icon + "No tiene permisos para ver esta página."
- Clean layout instead of a bare text message.

### Filter bar

- `Filter` icon leading the row.
- Event type `<select>`, module `<select>`, date range (from/to `<input type="date">`).
- "Clear filters" button (`X` icon) shown when any filter is active.
- All inputs use `text-caption` for compact dense layout.

### Improved icon distribution (2026-07-22)

Every inventory event now has a distinct icon instead of all using `Package`:

| Event | Icon |
|-------|------|
| INVENTORY_SALE | `ShoppingCart` |
| INVENTORY_ADJUSTMENT_POSITIVE | `TrendingUp` |
| INVENTORY_ADJUSTMENT_NEGATIVE | `TrendingDown` |
| INVENTORY_CLIENT_RETURN | `Undo2` |
| INVENTORY_SUPPLIER_RETURN | `ArrowLeft` |
| INVENTORY_ADMIN_BLOCK | `Ban` |
| INVENTORY_ADMIN_UNBLOCK | `Unlock` |
| INVENTORY_AUTO_EXPIRATION | `Calendar` |
| INVENTORY_PHYSICAL_COUNT | `ClipboardList` |
| INVENTORY_ADJUSTMENT_CREATED | `Edit` |
| INVENTORY_ADJUSTMENT_APPLIED | `Check` |
| INVENTORY_ADJUSTMENT_APPROVED | `CheckCheck` |
| INVENTORY_ADJUSTMENT_REJECTED | `X` |

### Motion treatment

- **Entrance**: No animation. Cards appear immediately on load/filter change.
- **Loading skeleton**: CSS `animate-pulse` on skeleton cards.
- **Expand**: Instant show/hide (no transition to avoid delay during fast
  browsing). Respects `prefers-reduced-motion` via global `@media` rule.

### Accessibility

- Day group headers are `<h2>` for document outline.
- Event cards are `<article>` with `aria-label` describing the event + time.
- Expand toggle is a `<button>` with `aria-expanded`.
- Filter selects and date inputs are labeled via `aria-label`.
- Pagination buttons labeled via `aria-label`.
- Color is never the sole differentiator: left border + icon + label + module.
- Category legend is a `role="region"` with `aria-label`.
- Role names use translated text, never raw English strings.

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

## User Management (added 2026-07-22)

A scan-friendly table for managing pharmacy staff. Designed for the manager/owner
who needs to see the team's status, roles, and last-login at a glance.

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│  Usuarios                              [↻] [+ Agregar usuario]│
│                                                               │
│  [Todos los roles ▼]  [Todos los estados ▼]                   │
│                                                               │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  USUARIO          ROL            ESTADO    ÚLT. INGRESO  │ │
│  │ ──────────────────────────────────────────────────────── │ │
│  │  ◉ Pedro Contreras  CONTADOR   ● Activo   Nunca         │ │
│  │    pedro.contreras                                       │ │
│  │                               [Desactivar] [Reset PIN]   │ │
│  │ ──────────────────────────────────────────────────────── │ │
│  │  ◉ María Rodríguez  CAJERO     ● Activo   Nunca         │ │
│  │    cashier1 · maria.r                                    │ │
│  │                               [Desactivar] [Reset PIN]   │ │
│  │ ──────────────────────────────────────────────────────── │ │
│  │  ◉ Admin Sistema    DUEÑO      ● Activo   22/7/2026     │ │
│  │    admin · admin@                                        │ │
│  └──────────────────────────────────────────────────────────┘ │
│  4 usuarios                                                   │
└──────────────────────────────────────────────────────────────┘
```

### Design decisions

| Decision | Rationale |
|----------|-----------|
| **Role badges with distinct colors** | Each role type gets a unique semantic color (cashier=teal, manager=amber, owner=violet, accountant=slate, inventory=teal). The manager can instantly see the role distribution without reading the text. |
| **Status pills with semantic colors** | Active=green, Disabled=gray, Locked=red. Color + text label — never color alone per WCAG. |
| **Sticky table header** | Column labels remain visible when scrolling through many users. Backdrop blur ensures readability over scrolling content. |
| **Action buttons visible always** | Unlike the clients module (where actions are hover-revealed), user management actions (disable, reset PIN) are always visible — they are infrequent operations that shouldn't require discovery. |
| **Inline username + email** | Secondary line in muted caption keeps the row compact while showing all identifiers. |
| **i18n for all role labels** | Role enums like `CASHIER`, `ACCOUNTANT` are translated via `t('roles.cashier')`, `t('roles.accountant')` — never displayed raw. The `translateRole()` helper in `user-management.helpers.ts` provides the mapping. |

### Role badge color mapping

| Role | Badge color |
|------|-------------|
| `CASHIER` | Pharma Teal `bg-pharma/10 text-pharma` |
| `MANAGER` | Urgency Amber `bg-urgency/10 text-urgency` |
| `OWNER`, `SAAS_ADMIN`, `ADMIN` | Restrict Violet `bg-restrict/10 text-restrict` |
| `ACCOUNTANT` | Sync Slate `bg-sync/10 text-sync` |
| `INVENTORY_ASSISTANT` | Pharma Teal `bg-pharma/10 text-pharma` |

### Status pill colors

| Status | Pill class |
|--------|------------|
| `ACTIVE` | `bg-success-container text-success` |
| `DISABLED` | `bg-ink/8 text-ink-muted` |
| `LOCKED` | `bg-error-container text-error` |

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

---

## Clients Module (added 2026-07-21)

The clients module was redesigned from a basic inline form/table into a
polished management interface with motion, icon-enhanced buttons,
toast notifications, a slide‑in edit panel, and an overlay delete dialog.

### Design decisions

| Decision | Rationale |
|----------|-----------|
| **Slide‑in edit panel** (right side, 400px max) | Keeps the table visible while editing — the cashier can reference client data without closing/reopening. Uses `motion` spring animation for natural feel. |
| **Overlay delete dialog** via `@radix-ui/react-dialog` | Proper focus‑trapping, `Esc` to close, ARIA `role="dialog"`. Matches the weight of a destructive action — the simple inline banner was too easy to accidentally confirm. |
| **Toast notifications** via `sileo` + `@/utils/notify` | Replaces inline success/error banners. Toasts appear at bottom‑right, auto‑dismiss after 4–8s, and never interrupt the search/edit flow. Palette‑mapped per the existing Sileo theme section. |
| **Lucide icons on all buttons** | Icons (`Plus`, `Pencil`, `Trash2`, `RefreshCw`, `Search`, `X`, `Check`, `User`, `AlertTriangle`) give visual anchors that text alone lacks — critical in a fast‑paced POS where the cashier glances at button shapes. |
| **Staggered row appear animation** | Rows fade in with a 30ms stagger (`motion` `variants` + `custom` index). Barely perceptible at <5 rows, but keeps the list from appearing all‑at‑once when many clients load. Respects `prefersReducedMotion`. |
| **Action buttons hidden until hover/focus** | Edit and Delete icon‑buttons are `opacity-0` by default, shown on `group-hover:opacity-100` and `focus-within:opacity-100`. Keeps the table visually clean; the cashier's muscle memory learns exactly where actions live. |
| **Initial avatar circle** | Each row shows the first letter of the client's name in a Pharma‑Teal‑tinted circle. Adds visual differentiation without loading images — a pure‑CSS solution that works offline. |
| **Table head stays sticky** | `sticky top-0` on `<thead>` ensures column labels remain visible when scrolling through many results. A 2px Pharma‑Teal bottom border separates head from body. |

### Form animation

The create form appears inline with an opacity + translateY animation
(0.25s easeOut). The edit form slides in from the right with a spring
(damping: 28, stiffness: 300). Both use `AnimatePresence` for clean
exit transitions. `prefers-reduced-motion` collapses all to instant.

### Empty states

Three distinct empty states, each with an illustrated icon circle:

1. **Before first search** (`hasLoaded=false`): `Users` icon in muted circle.
2. **No results** (`hasLoaded=true, results=0`): `SearchX` icon in urgency‑tinted circle.
3. **Loading** (`isSearching=true`): `Loader2` spinner in Pharma Teal.

### Accessibility

- Delete dialog is a `@radix-ui/react-dialog` with `Dialog.Title`,
  `Dialog.Description`, and focus management.
- Search input has `aria-label` and a clear button with `aria-label`.
- Table action buttons have `aria-label` + `title`.
- Row hover uses `whileHover` from `motion` for GPU‑accelerated
  background color change (no JS‑driven hover).
- All animations respect `prefers-reduced-motion` via `useReducedMotion()`.

### Client details dialog (added 2026-08-03)

Clicking anywhere on a client row opens a read-only details modal
(`ClientDetailDialog`) so the cashier can inspect a client without
entering the edit panel. A dedicated eye (👁) icon button — visible on
row hover, like edit/delete — covers keyboard and screen-reader users,
and the action buttons stop propagation so they never trigger the row
click.

| Decision | Rationale |
|----------|-----------|
| **Overlay modal via `@radix-ui/react-dialog`** | Same pattern as the delete dialog: focus-trapping, Esc-to-close, `role="dialog"`. The edit panel stays reserved for editing — viewing is a lighter, faster read-only action. |
| **Avatar + name + status badge header** | Mirrors the table row's avatar treatment; the Active/Inactive badge (colored dot + label, never color alone) gives status at a glance. |
| **Document as Dialog description** | The ID type badge + tabular-nums number sits directly under the name, serving as the accessible dialog description. |
| **Detail rows with leading icons** | Email, phone, address, and city reuse the form's icon language so the modal feels like the same module, not a new screen. |
| **Created / updated meta line** | Muted captions with calendar/clock icons, dates via `formatShortDate` (locale-aware). |
| **Edit hand-off button** | The footer's primary action closes the modal and opens the slide-in edit panel with the same client — one click from view to edit, no re-finding the row. |
| **Recent sales history section** | The modal shows the client's 5 most recent confirmed sales (number, date, invoice, total) via `SalesHistoryService.listConfirmedSales({ clientId, limit: 5 })` — no new backend surface, reuses the sales-history module conventions for currency and date formatting. A count badge shows the full total of confirmed sales for the client. |

### Sales history section states

| State | Render |
|-------|--------|
| Loading | Inline Pharma-Teal spinner + "Cargando..." |
| Error | Muted urgency text — the failure never blocks the rest of the modal |
| Empty | "Sin ventas registradas" caption |
| Items | Rows: `#número` (Pharma Teal, `font-data`) · date + invoice number (muted captions) · total (right-aligned `font-data`, es-CO `$` format, 2 decimals, same as the sales-history module) |

Fetched on open with a cancellation guard keyed to `client.id`; the list is
read-only and intentionally compact — the full sales-history screen is the
place for pagination, filters, and fiscal/operational detail.

### Motion

- Fade + scale entrance (0.2s easeOut) on overlay and content, identical
  to the delete dialog; collapses to instant with `prefers-reduced-motion`.
- No periodic or decorative motion — a read-only inspection surface.

---

## Supplier details dialog (added 2026-08-03)

Clicking anywhere on a supplier row opens a read-only details modal
(`SupplierDetailDialog`) so the user can inspect a supplier without
entering the edit form. The pattern mirrors the client detail dialog
(see above).

| Decision | Rationale |
|----------|-----------|
| **Overlay modal via `@radix-ui/react-dialog`** | Same Radix Dialog pattern as the delete dialog and client detail dialog: focus-trapping, Esc-to-close, `role="dialog"`. |
| **Avatar icon** | Uses a `Building2` icon in a Pharma‑Teal circle instead of an initial-letter avatar — suppliers are organisations, not individuals. |
| **Detail rows with leading icons** | Same icon‑enhanced grid as the client detail dialog, reusing the purchases module's `formatCOP` for the credit limit field. |
| **Commercial terms footer** | Payment terms days and credit limit shown in a muted caption row below the contact grid — key procurement info at a glance. |
| **Edit hand-off button** | Closes the modal and opens the supplier edit form with the same supplier — one click from view to edit. |
| **Stops propagation on action buttons** | The view/edit/deactivate buttons use `onClickCapture` with `e.stopPropagation()` so clicking them never triggers the row's `onView` handler. |

### Motion

- Fade + scale entrance (0.2s easeOut) on overlay and content, identical
  to the delete dialog; collapses to instant with `prefers-reduced-motion`.

---

## Sales History (added 2026-07-24)

A manager-only read-only view of confirmed sales. Each row is a local sale tied
(permanently) to its DIAN fiscal invoice, with a secondary operational layer
that can override the client, contact info, payments, delivery notes, tags, and
custom fields without changing what DIAN received.

### Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  Historial de ventas                       [↻ Refrescar]           │
│  Ventas confirmadas con factura DIAN y vista operativa               │
│  [Buscar venta, cliente o factura...] [Desde ▼] [Hasta ▼] [✕]     │
│                                                                     │
│  Mostrando 23 de 50                                                │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │ Venta │ Fecha     │ Cliente     │ Total │ Factura │ Estado │ …││
│  │ #1245 │ 23/07/26  │ Juan Pérez  │ $45.600 │ FE-123 │ Autorizado ││
│  │ #1244 │ 23/07/26  │ Consumid... │ $12.300 │ FE-122 │ Autorizado ││
│  └────────────────────────────────────────────────────────────────┘│
│  [Cargar más]                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Detail side panel

Two tabs: **Fiscal (DIAN)** (read-only) and **Operativa (droguería)** (editable
annotation layer). The fiscal tab shows the invoice number, CUFE, status, buyer,
seller, line items, and totals. The operational tab shows the current
operational client, contact info, payments, delivery info, notes, tags, and
custom fields, plus a button to create a new adjustment.

### Design decisions

| Decision | Rationale |
|----------|-----------|
| **Split fiscal vs. operational** | A Colombian drugstore must be able to prove to DIAN exactly what was invoiced while still correcting the local operational record (e.g., a client change that does not affect the fiscal document). |
| **Ambient difference indicator** | The operational tab shows a small amber dot when an override differs from the fiscal view — the same color language as near-expiry alerts. |
| **Tabular figures everywhere** | Totals, prices, quantities, and CUFE numbers use JetBrains Mono with `tabular-nums` so columns align. |
| **No inline editing** | All changes go through the multi-step adjustment modal so the manager must provide a reason and confirm the diff before the audit trail is written. |

### Client-change adjustment

The `CLIENT_CHANGE` editor offers a searchable client list populated from the
local client catalog. Selecting a client fills the name, ID type, and ID number
fields. The manager can still edit the fields manually, and an optional client
ID links the sale to a specific client record without altering the DIAN buyer.

### Accessibility

- Sales table uses semantic `<table>` with `<th scope="col">`.
- Each row is clickable with a dedicated "View" button for keyboard users.
- Date inputs and the search field have `aria-label`.
- The fiscal/operational tabs use `role="tablist"` / `role="tab"` / `aria-selected`.
- Empty state includes an icon, explanation, and a clear-filters action.

### Motion

- Initial load: skeleton rows only; no entrance animation.
- List refresh: spinner inside the refresh button.
- Detail panel appears instantly when a row is selected.
- No full-screen motion on the high-throughput list — the manager is scanning
  rows, not watching a transition.

---

## Print Queue & Printers

### Design rationale

The print queue is an operational tool, not a consumer screen. The cashier
needs at a glance: is my receipt printing? Did it fail? How do I retry?
Every printer card and job row must communicate status without relying on
colour alone — a dot, a text label, and a contextual action button.

Status colours map to the palette:
- **COMPLETED / ONLINE** → Pharma Teal (`#0B6E6B`) — everything normal.
  Badge uses `success-container` (`#E0F2F1`) bg.
- **PENDING / NO_PAPER** → Urgency Amber (`#E8780A`) — needs attention
  soon. Badge uses `urgency-surface` (`#FFF3E5`) bg.
- **FAILED / ERROR** → Error (`#D32F2F`) — action required. Badge uses
  `error-container` (`#FCE4E4`) bg.
- **PRINTING** → Pharma Teal (`#0B6E6B`) — active state, not alarming.
- **DISCARDED / OFFLINE** → Ink Muted (`#8B8A87`) — neutral terminal
  state. Badge uses `surface-variant` (`#EDE9E1`) bg.
- **RETRYING** → Urgency Amber (`#E8780A`) — transitional, in-progress.

All status badges pair a `bg-{token}` background with a `text-{token}` label
and a `dot` circle — never colour alone.

### Print Queue layout

```
┌──────────────────────────────────────────────────────────────┐
│  Cola de impresión                    [Reintentar todos] [↻] │
│━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────┐ │
│  │   3  │ │   1  │ │   2  │ │   0  │ │  47  │ │   1.4    │ │ ← summary stats
│  │Pend. │ │Imprim│ │Fall. │ │Desc. │ │Comp. │ │Intentos  │ │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────────┘ │
│━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
│  [Todos] [Pendientes] [Fallidos] [Completados] [Descartados] │ ← filters
│━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ ● Pendiente   Recibo de venta   Intento 0              │ │ ← job row
│  │   Creado: 27/07/26 14:30                                │ │
│  │                                          [Retry] [Disc.]│ │
│  ├─────────────────────────────────────────────────────────┤ │
│  │ ● Fallido     Factura electrónica   Intento 3/10       │ │
│  │   Creado: 27/07/26 14:22                                │ │
│  │   Error: printer timeout                                │ │
│  │   ▸ Bitácora de enrutamiento          [Retry] [Disc.]   │ │
│  ├─────────────────────────────────────────────────────────┤ │
│  │ ● Completado  Cierre de turno        Intento 1          │ │
│  │   Creado: 27/07/26 13:15  Completado: 27/07/26 13:16   │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### Printer Card layout

```
┌──────────────────────────────────────┐
│ EPSON TM-T88VI            ● En línea │ ← name + status badge
│ EPSON-123456                         │ ← system name
│                                      │
│ [USB] [Térmica] [80 mm]             │ ← type badges
│ [Recibos] [Facturas] [Cierres]      │ ← job-type chips (pharma/10 bg)
│                                      │
│ ⏱ 3 pendiente(s)                     │ ← pending count (urgency)
│ ───────────────────────────────────  │
│ [Probar] [Editar]  [Eliminar]        │ ← action buttons
└──────────────────────────────────────┘
```

### Motion

- Job rows enter with `x: -8` slide and fade; exit with height collapse.
  Quick enough to not block scrolling (80ms per row).
- Summary stats stagger in with 50ms delay per stat, 200ms duration.
- Printer cards enter with `y: 8` fade; exit with scale collapse.
- Discard/delete confirmation dialogs use Radix `animate-in`/`animate-out`.
- Test print result appears as a brief `y: -4` slide-in message below the
  action bar; auto-hides on next action.
- All animations respect `prefers-reduced-motion` via the global CSS reset.

---

## License Status Panel (added 2026-07-27)

The license status panel is an admin/owner screen showing subscription details,
plan features, location assignment, and check-in health.

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  🛡 Estado de Licencia              [↻ Renovar] [↓ Exportar]     │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ 🛡 Plan Profesional                    Activa hasta 31/12/26  │ │
│  │ ⏱ 184 días restantes                                         │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌──────────────────────┐  ┌────────────────────────────────────┐ │
│  │ ✓ Plan contratado    │  │ 🏪 Asignación                      │ │
│  │ ✓ Profesional        │  │ Local: Droguería La Esperanza      │ │
│  │                      │  │ Calle 123 #45-67, Bogotá           │ │
│  │ Características:     │  │ Puesto: Caja Principal             │ │
│  │ ✓ Múltiples locales  │  │ Activado: 15 enero 2026            │ │
│  │ ✓ Reportes avanzados │  └────────────────────────────────────┘ │
│  │ ✓ Sync multi-terminal│                                         │
│  └──────────────────────┘                                         │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ 📋 Historial de check-in                                     │ │
│  │ ⏱ Último check-in: 27/07/26, 14:30                           │ │
│  │ ⏱ Días hasta vencimiento: 184                                │ │
│  │ 📋 Check-ins (30d): 28                                       │ │
│  │ ✓ Todo al día                                                │ │
│  └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### Design decisions

| Decision | Rationale |
|----------|-----------|
| **Hero card with left border color** | The 4px left border uses domain colors (pharma teal=active, urgency amber=grace, error red=locked/revoked). The cashier/admin sees the status at a glance without reading text. |
| **Icon in every panel header** | Each panel (plan, assignment, checkin) uses a distinct lucide-react icon as a visual anchor. This matches the pattern used in the clients, audit, and user management modules. |
| **font-data for numbers** | Expiry counts, days remaining, and check-in counts use JetBrains Mono with tabular-nums for unambiguous reading. |
| **Grace period warning with AlertTriangle** | When in grace period, the amber urgency color + alert icon appears inline in the check-in panel, not as a separate banner. This follows the pattern of inline status indicators (near-expiry, low-stock) used throughout the app. |
| **Check-in health indicator** | A green checkmark + "Todo al día" message when active gives positive reinforcement. No news is good news, but a small confirmation helps the admin know the check-in mechanism is working. |
```

---

## Sync Module (redesigned 2026-07-27)

The sync module encompasses three visible surfaces: the Ambient Sync Pulse (full‑width line below the header), the Sync Attention Banner (advisory banner for permanent failures or stale pending entries), and the Sync Health dashboard (admin‑only management screen for reviewing and retrying failed sync operations).

### Design decisions

| Decision | Rationale |
|----------|-----------|
| **Sync Pulse uses CSS animations, motion only for mount** | The pulse rhythm is an ambient background presence — it must not draw attention. CSS `@keyframes` handle the continuous fade cycle; `motion` handles only the initial mount entrance (400ms easeOut) so the bar appears smoothly when the app loads. |
| **Attention Banner uses AnimatePresence for enter/exit** | The banner slides in and out with height‑collapse animation (250ms easeOut) to avoid jarring layout shifts when sync state changes. Always present as `role="alert"` with `aria-live="assertive"`. |
| **Attention Banner colors map to design system** | Sync‑related advisory → `bg-urgency/10` + `border-urgency/40` + icon `AlertTriangle`. Backup‑critical → `bg-error-container` + `border-error/40` + icon `TriangleAlert`. Never raw Tailwind amber/red. |
| **KPI grid uses staggered entrance animation** | Tiles appear with `y: 12` fade‑up, 60ms stagger delay per tile. Brief enough (<300ms for 5 tiles) to not block reading. Respects `prefers-reduced-motion`. |
| **Each KPI tile has a distinct lucide icon** | `Clock` (pending), `AlertTriangle` (failed 24h), `Ban` (permanent failures), `TrendingUp` (success rate), `HardDrive` (last backup). Gives visual anchors for quick scanning. |
| **KPI accent borders use semantic tokens** | Pending/failed → `border-l-warning`/`border-l-error`. Success rate → `border-l-pharma`. Backup → `border-l-success`/`border-l-warning`/`border-l-ink-muted` depending on health. |
| **Action bar uses design‑system buttons** | Connection test → success/error container backgrounds. Primary action (Run sync now) → `pos-button-primary` (pharma teal). Export → `pos-button-secondary`. Checkboxes → pharma teal focus ring. All replace previous raw blue‑600 / gray‑300 Tailwind classes. |
| **Connection status feedback uses motion** | When the test‑connection button completes, a brief sliding label (`x: -8` fade, 200ms) confirms reachable/unreachable. Auto‑dismisses after 5s via the parent page. |
| **Inline SVGs replaced with lucide‑react** | `Radio`, `RefreshCw`, `FileDown`, `FileJson`, `CheckCircle2`, `XCircle`, `Loader2` replace raw SVG paths. Consistent icon language with the rest of the app (clients, audit, user management). |
| **All hardcoded strings replaced with i18n** | Every visible string in `kpi-grid`, `action-bar`, `sync-pulse`, and `sync-attention-banner` uses `useTranslation` with keys under the `sync.` namespace. No English fallback strings in components. |

### Sync Pulse states (unchanged from original design)

| State | Color | Animation | Opacity |
|-------|-------|-----------|---------|
| `online` | Pharma Teal `#0B6E6B` | Static | 0.6 |
| `offline` | Sync Slate `#4A6572` | CSS pulse (3s ease‑in‑out) | 0.4 → 0.8 |
| `draining` | Sync Slate `#4A6572` | CSS drain (1.5s ease‑in‑out) | 0.7 → 1.0 |

### Sync Health dashboard layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Salud de sincronización           [↻ Auto‑30s]                  │
│                                                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ 🕐 3     │ │ ⚠ 12    │ │ 🚫 2     │ │ 📈 94.2% │ ← KPI grid │
│  │ Pend.    │ │ Fall.24h │ │ Perm.    │ │ Éxito    │            │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘            │
│                                                                   │
│  [Auth Badge] [📡 Test] [↻ Sync now] [↓ CSV] [↓ JSON] │ ⃞ Retry…│
│                                                                   │
│  ┌─ Timeline ──────────────────────────────────────────────────┐ │
│  │ ▁▃▆▇▆▅▃▂▁▃▅▇▆▄▃▂▁▃▅▇▆▄▃▂                                 │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─ Failure breakdown ──────────────────────────────────────────┐ │
│  │ ● SALES        12 (52.2%)  ████████████████                  │ │
│  │ ● INVENTORY     6 (26.1%)  ████████                          │ │
│  │ ● CLIENTS       3 (13.0%)  ████                              │ │
│  │ ● AUTH          2 (8.7%)   ██                                │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─ Permanent failures ─────────────────────────────────────────┐ │
│  │ │ Tipo    │ Intentos │ Últ. intento │ Acciones │             │ │
│  │ │─────────┼──────────┼──────────────┼──────────│             │ │
│  │ │ SALES   │ 5/10     │ 14:32:01     │ [↻][🗑]  │             │ │
│  │ │ INVENT. │ 3/10     │ 14:28:44     │ [↻][🗑]  │             │ │
│  │ │ ...     │          │              │          │             │ │
│  └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

---

## Phase 7 - Sales-commission mark (added with the commission feature)

### New token

| Name | Hex | Rationale |
|------|-----|-----------|
| **Commission Gold** | `#A16207` | Money/incentive signal, deliberately distinct from Urgency Amber `#E8780A` (attention) and Pharma Teal (trust). Deep gold reads as "this line earns a bonus", never as a warning. Used only for the commission badge and its surface tint `#FEF6E0` (AA ~5:1 on white). |

### Badge behavior

One recurring element, three placements, one rule:

- **`CommissionBadge`** (`components/common/commission-badge.tsx`) renders "COMISION" only when a product has a commission configured (type != NONE and value > 0). Same label in every state - only intensity changes:
  - solid gold - the validity window contains now (the line is accruing commission);
  - 50 % opacity - window set but not yet started / already expired (configured, not earning).
- Placement: product search cards and cart lines (the cashier sees the mark before and after adding to cart) and the product-management table next to the commercial name (the person configuring the catalog sees which products earn).
- Tooltip / `aria-label` always carries the detail: rate ("5 %") or per-unit amount ("$2.000/unidad"), window bounds ("desde X - hasta Y"), and "fuera de vigencia" when the window does not contain now. Never color alone.
- Computed against the current moment at render; the badge does not force re-renders and is not on the scan/add critical path - it is a static mark, no animation.

## Phase 8 - Commission in reports

Commission surfaces in three existing sales reports as a plain currency column, reusing the same column machinery (catalog -> table, exports, print) so the report engine needed no new UI:

- **Sales daily summary**: `totalCommission` column ("Comision total") - the day's accrued commission, after `netSales`. Scalar subquery over `SaleItem.commissionAmount` per sale so the `Sale`-level sums are not row-multiplied by the join.
- **Sales by cashier**: `commissionAmount` column, after `netSales` - this is the accrual per cashier (`Sale.userId`), the number a shift-close conversation will reference.
- **Sales by product**: `commissionAmount` column, after `netRevenue` - which catalog products actually earn.

Snapshots, not live config: values come from `SaleItem.commissionAmount` (frozen at sale time), so historical reports are stable even if a product's commission window or rate later changes. Zero accrual rows just show $0; no special styling, no chart series - commission is a number column, not a highlighted signal.

## Phase 9 - Shift picker for the cash-shift close report

The CASH_SHIFT_CLOSE report's filter is no longer a raw ID text input - cashiers do not carry shift IDs in their heads. It is now a searchable selector (Radix Popover hosting a cmdk Command list) that loads the workstation's shift history (`cashShiftService.getShiftHistory`, closed/forced-close shifts only - an open shift has no closing document) and lets the cashier type a date fragment or shift ID to filter:

- Trigger button shows the selected shift as a date range ("01/07/2026, 08:00 - 01/07/2026, 18:00") or the placeholder text.
- Options render the same date-range label plus a state chip; forced closes carry the urgency amber tint (`text-amber-700`), normal closes stay muted - the same "pair color with a label" rule as lot/commission signals, applied to a selector row.
- Typing filters by label and by shift ID fragment (cmdk `keywords`), so both "yesterday's shift" and "the ID on the receipt" paths work.
- List is capped at the 50 most recent shifts (`getShiftHistory` limit) - a closing document is always recent, and an unbounded list would defeat the search.
- The empty/loading states are calm text ("Cargando turnos..." / "No hay turnos cerrados"), never an error; the not-ready hint from Phase 8 still appears until a shift is chosen.

## Phase 10 - Domicilio (delivery) checkout control

Domicilio is an optional second lane of checkout: the cart stays the center of truth and delivery adds a fee line above the grand total. It is tenant-policy-driven, entirely from `effectiveConfig.workflow.delivery` (no local policy logic in the view layer).

### Pass 1 - brief

- **Palette:** None new. Reuses Sync Slate `#4A6572` (delivery is a location connotation already used for the sync ambient) for the toggle and summary accents, Panel White for the form dialog — same surface language as the restricted-sale dialog.
- **Type:** existing UI (Inter) for labels, JetBrains Mono `tabular-nums` for the fee and the totals row.
- **Layout:** inside the cart panel's totals cluster, above the TotalsSummary divider:

```
CartPanel (right 40%)
┌──────────────────────────────┐
│ CARRITO (3)                  │
│ ...line items...             │
│ ┤ Domicilio ───────────────┐ │   dashed toggle → opens dialog
│ │ [🚚 Domicilio]           │ │
│ └──────────────────────────┘ │
│ ┤ Domicilio ───────────────┐ │   set: card w/ address, fee · schedule,
│ │ 🚚 Cra 14 #47-20         │ │   [✎ edit] [✕ remove]
│ │    $8.000 · 05/08 2:00pm │ │
│ └──────────────────────────┘ │
│ Subtotal:  $55.600           │
│ IVA (19%): $10.564           │
│ Domicilio: $8.000            │
│ ─────────────────────────    │
│ TOTAL:     $74.164           │
│ [COBRAR →]                   │
└──────────────────────────────┘
```

- **Signature interplay:** fee line and summary reuse Sync Slate accents so "delivery present" reads consistently at a glance mid-transaction; the dialog is the only modal in the cart flow (restricted-sale already owns modal space in the search flow), so the two regulatory/optional confirmations never collide.

### Pass 2 - critique

- Not a generic togglist: the enable toggle only exists when the tenant ships a delivery policy (`enabled`), auto-disables with a hint while a client is required but none is selected (`requiresClient`), and the dialog's field set is a 1:1 of the policy flags (`addressRequired`, `phoneRequired`, `allowScheduling`, `FIXED`/`MANUAL` fee with `maxDeliveryFeeCents` cap). A CRM's "shipping toggle" has none of these regulatory couplings.
- Validation mirrors the sales-pos service exception codes (`DELIVERY_REQUIRES_CLIENT`, `DELIVERY_ADDRESS_REQUIRED`, `DELIVERY_PHONE_REQUIRED`, `DELIVERY_FEE_POLICY`) so the UI never enforces a stricter (or looser) rule than the service.
- Numbers stay unambiguous: fee and totals are `font-data` `tabular-nums`, and the total row switches to the grand total (`selectGrandTotalCents`) everywhere money is due (cart + payment screen).

### Files

- `renderer/hooks/use-delivery-config.ts` - subscription to `tenantConfigStore` → `effectiveConfig.workflow.delivery`, falling back to `DEFAULT_DELIVERY` (feature off) while the config loads.
- `renderer/components/SalesTransaction/delivery-form-dialog.tsx` - Radix Dialog form; seeds from the existing draft when editing; fee input via the shared `CurrencyInput` (MANUAL mode), read-only line for FIXED mode.
- `renderer/components/SalesTransaction/delivery-toggle.tsx` - toggle/card + remove, owns dialog open state and dispatches `sales-slice` `setDelivery`.
- Cart/payment/receipt/history wiring: `cart-panel` + `totals-summary` fee line + grand total, `payment-processing` total due = grand total, `receipt` passes the draft + fee to `generateReceiptHtml` (which already prints the `*** DOMICILIO ***` block and fee), sales-history operational card shows the fee.

---

## Data import wizard (added 2026-08-21)

CSV/Excel mass import for Products and Clients, one shared multi-step dialog
(`renderer/components/data-import/import-dialog.tsx`) rendered by both
sections. Design decisions:

| Decision | Rationale |
|----------|-----------|
| **One generic dialog, two hosts** | The flow is identical for both entities; the only differences are the column set (shared-validation metadata) and the role gate. Duplicating it per section would double the surface for no gain. |
| **Three steps: select → preview → result** | Preview is the safety step per the import contract: nothing is written until the operator confirms. The confirm button states the exact row count ("Importar N filas válidas") and is disabled at 0. |
| **Preview colors follow the palette roles** | Valid count = Pharma Teal, row errors = Urgency Amber (fix-and-retry, not alarm), file-level failure banner = reserved error red, ignored columns = Sync Slate (informational). Never color alone: every count/alert carries a text label. |
| **Per-row messages rendered verbatim** | Zod messages from shared schemas are Spanish on purpose; the dialog renders `issue.path` in JetBrains Mono + `issue.message` as-is, never translated. |
| **Domain error codes → i18n** | `IMPORT_FILE_INVALID` / `IMPORT_VALIDATION_FAILED` / `IMPORT_ROW_REJECTED` / `IMPORT_EXECUTION_FAILED` map to i18n titles; the raw English domain message appears as muted detail. `NO_ACTIVE_SESSION`/`INSUFFICIENT_ROLE` reuse the existing `errors.*` copy. |
| **Roles change visibility** | `canImportEntity()` mirrors the service's `assertRoleFor` + OWNER/SAAS_ADMIN supersession so the button is hidden for roles that would always fail. The service stays the authority. |
| **Motion budget respected** | Dialog entrance fade/scale only (same as other Radix dialogs). Step changes are instant — the wizard is a tool, not a moment. The only loading motion is the functional spinner during preview/execute. |
| **Execute honesty** | While executing (row-by-row under the write lock, up to 5,000 rows) the dialog blocks close, shows a Sync-Slate status notice, and the primary button becomes "Importando...". |
| **Numbers are tabular** | Counts, row numbers, and importId use `font-data tabular-nums`. Sample table headers are the shared column labels, so preview matches the downloaded template exactly. |
| **Display caps** | Preview error list renders 100 rows then collapses into "… y N errores más" (a 5,000-row file with systematic errors must not render 5,000 cards). Execute errors are already capped at 50 by the service. |
| **Template download** | `buildTemplate` (CSV string with BOM / XLSX ArrayBuffer) → `saveFileWithDialog` (native save dialog in Tauri, browser fallback in dev). |

## Licensing Plans & Self-Service Checkout (added 2026-08-21)

### Pass 1 — Brief

Four-step flow: plan catalog -> customer form -> external Wompi payment -> result.

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Palette | Reuse existing tokens only. Pharma Teal = primary CTA and selected period; discount badges use g-pharma/10 text-pharma (savings reads as trust, not urgency); polling = Sync Slate (calm waiting, offline-first language); declined/error = reserved error red; timeout = Sync Slate with clock (pending, not failed) | A subscription purchase is a trust moment; teal carries that. Amber is reserved for near-expiry stock signals and must not compete here. |
| Type | Plan names in Inter semibold; every price, capacity count, and the activation code in JetBrains Mono 	abular-nums | The customer watches the screen while the cashier pays; period amounts and the final activation code are the two numbers that must be read without ambiguity. |
| Layout | Catalog = header + segmented period control + responsive card grid (1/2/3 columns). Form, payment and result = single centered panel (max-w-lg) — these steps are short and focused, a wide layout would scatter attention. | |
| Signature | The activation code handoff: the approved result shows the code in grouped JetBrains Mono blocks with a copy button. It is the one element of this flow a customer physically carries away, so it gets the data-display treatment (mono, grouped, copyable) instead of being a plain text line. | Reuses the app-wide mono-data language; no new signature element competes with the ambient sync pulse. |

### Pass 2 — Critique

- Pricing-page risk: generic SaaS pricing grids use soft-shadow cards + pastel badges. Countered: cards are pos-panel working surfaces with order-border, prices are mono tabular, the CTA is the app's standard pos-button-primary. Discount badges are text-labeled ("10% OFF") — never color alone.
- Motion budget: the only orchestrated moment is the approved-result check (existing SuccessCheckIcon draw-in, which already collapses under prefers-reduced-motion). Period switching, card selection and form steps are instant state changes; the only spinner is the functional polling indicator.
- Ambiguity guard: quarterly/annual prices show the period amount with its unit (/trimestre, /año) plus the discount badge, so the cashier cannot mistake a quarterly total for the monthly rate.

## Keyboard-first sales flow (added 2026-08-22)

### Pass 1 - Brief

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Selection signature | The selected cart line is marked by a 3px Pharma Teal left accent bar (inset box-shadow) plus a 6% Pharma Teal row tint. The quick-edit editor row directly below it shares the tint, so the selected line + its editor read as one continuous block. | ArrowUp/ArrowDown line selection is the spine of the keyboard flow; the accent must be visible at a glance mid-scan without changing row metrics (inset shadow, no layout shift). Teal = trust/primary state; the tint is the same 6% color-mix language already used across the cart. |
| Scanner feedback | Failed Enter submits (not-found / incomplete) show a brief Urgency Amber boxed line under the search input with role=alert; the query clears instantly so the scanner can retry. | Amber = "needs attention, retry now" — not error red (nothing is broken) and not slate (this is not an offline condition). Feedback must never block the scan cadence. |
| Quick edit | Inline editor on the selected row with a mode prefix (× qty / % discount / = price), mono tabular input, Enter commits, Escape cancels, focus returns to the search input on close. | Mirrors cart-line-item's inline price/discount editing language but is keyboard-native; returning focus to search keeps the scanner flow unbroken. |

### Pass 2 - Critique

- Generic-dashboard check: row selection via accent bar + tint is a POS/terminal idiom (lightning checkout), not a SaaS list pattern; it is paired with the persistent cart header keyboard hint (↑↓ seleccionar · F9 cobrar · Ctrl+Z deshacer) in the same muted-caption style as HelpBar — discoverability without decoration.
- Motion budget: zero animation added. Selection is an instant state change (inset bar + tint swap), matching the <100ms search/scan budget.
- Color independence: selection is also implied by the editor input's aria-label and the header hint text; feedback boxes carry text, not color alone.
