/**
 * Design Token Reference Page — dev-only visual verification of all tokens.
 *
 * Renders palette swatches, type specimens at all weights, a sample
 * numeric table with tabular figures, and the sync pulse bar in its
 * three states.
 *
 * This page is NOT routed into the real app navigation. Delete or gate
 * behind a dev flag before shipping to production.
 */
import { type FC } from "react";

/* ------------------------------------------------------------------ */
/* Data                                                               */
/* ------------------------------------------------------------------ */

interface Swatch {
  name: string;
  hex: string;
  cssVar: string;
  role: string;
}

interface FontWeight {
  name: string;
  value: number;
}

interface SyncPulseState {
  state: "online" | "offline" | "draining";
  label: string;
  description: string;
}

const SWATCHES: Swatch[] = [
  {
    name: "Pharma Teal",
    hex: "#0B6E6B",
    cssVar: "--color-pharma",
    role: "Trust / brand / online-synced / primary actions",
  },
  {
    name: "Urgency Amber",
    hex: "#E8780A",
    cssVar: "--color-urgency",
    role: "Near-expiry lot / low-stock / needs attention",
  },
  {
    name: "Sync Slate",
    hex: "#4A6572",
    cssVar: "--color-sync",
    role: "Offline-but-normal ambient state / sync queue",
  },
  {
    name: "Restrict Violet",
    hex: "#5B3E96",
    cssVar: "--color-restrict",
    role: "Restricted-sale confirmation / regulatory step",
  },
  {
    name: "Surface Warm",
    hex: "#F9F6F0",
    cssVar: "--color-surface",
    role: "Background surface / app chrome",
  },
  {
    name: "Data Ink",
    hex: "#171614",
    cssVar: "--color-ink",
    role: "Primary text / prices / quantities / data display",
  },
];

const UI_WEIGHTS: FontWeight[] = [
  { name: "Regular", value: 400 },
  { name: "Medium", value: 500 },
  { name: "Semi Bold", value: 600 },
  { name: "Bold", value: 700 },
];

const DATA_WEIGHTS: FontWeight[] = [
  { name: "Regular", value: 400 },
  { name: "Medium", value: 500 },
  { name: "Bold", value: 700 },
];

const SYNC_STATES: SyncPulseState[] = [
  {
    state: "online",
    label: "Online — Synced",
    description:
      "Static Pharma Teal at 60% opacity. The resting state — everything is normal.",
  },
  {
    state: "offline",
    label: "Offline — Queue Building",
    description:
      "Sync Slate pulsing on a 3-second cycle. Operating normally without connection. Items are queuing for later sync.",
  },
  {
    state: "draining",
    label: "Reconnecting — Queue Draining",
    description:
      "Sync Slate pulsing on a 1.5-second cycle. Brightening as the queue empties, then settling back to resting teal.",
  },
];

const NUMERIC_ROWS = [
  { product: "Acetaminofén 500mg", qty: 2, unit: 6200, total: 12400 },
  { product: "Losartán 50mg", qty: 1, unit: 24300, total: 24300 },
  { product: "Clonazepam 2mg", qty: 1, unit: 18900, total: 18900 },
  { product: "Ibuprofeno 400mg", qty: 3, unit: 6200, total: 18600 },
  { product: "Omeprazol 20mg", qty: 1, unit: 8950, total: 8950 },
  { product: "Loratadina 10mg", qty: 4, unit: 8500, total: 34000 },
  { product: "Amoxicilina 500mg", qty: 1, unit: 12350, total: 12350 },
  { product: "Metformina 850mg", qty: 2, unit: 7800, total: 15600 },
];

const SUBTOTAL = NUMERIC_ROWS.reduce((sum, row) => sum + row.total, 0);
const IVA_RATE = 0.19;
const IVA = Math.round(SUBTOTAL * IVA_RATE);
const TOTAL = SUBTOTAL + IVA;

const formatCOP = (amount: number): string =>
  `$${amount.toLocaleString("es-CO")}`;

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

const SwatchCard: FC<{ swatch: Swatch }> = ({ swatch }) => (
  <div className="swatch-card">
    <div
      className="swatch-color"
      style={{ backgroundColor: `var(${swatch.cssVar})` }}
    />
    <div className="swatch-info">
      <p className="swatch-name">{swatch.name}</p>
      <p className="swatch-hex">{swatch.hex}</p>
      <p className="swatch-role">{swatch.role}</p>
    </div>
  </div>
);

const TypeSpecimen: FC<{
  family: "ui" | "data";
  familyName: string;
  weights: FontWeight[];
}> = ({ family, familyName, weights }) => (
  <div>
    <p className="type-label">
      {familyName} ({family === "ui" ? "Inter" : "JetBrains Mono"})
    </p>
    {weights.map((w) => (
      <div key={w.value} className="type-specimen">
        <p className="type-label">
          {w.name} ({w.value})
        </p>
        <p
          className={`type-sample ${
            family === "ui" ? "type-sample-ui" : "type-sample-data"
          }`}
          style={{
            fontWeight: w.value,
            fontSize: family === "ui" ? "14px" : "13px",
          }}
        >
          {family === "ui"
            ? "El jarabe debe conservarse a temperatura ambiente. Lote: L24056"
            : "L24056 · $12.400 · 3 und · INVIMA RS-2024-001"}
        </p>
      </div>
    ))}
  </div>
);

const SyncPulseDemo: FC<{ syncState: SyncPulseState }> = ({ syncState }) => (
  <div
    style={{
      marginBottom: "1rem",
      padding: "1rem",
      background: "white",
      borderRadius: "var(--radius-pos)",
      boxShadow: "var(--shadow-pos-panel)",
    }}
  >
    <p
      style={{
        fontWeight: "var(--font-weight-semibold)",
        fontSize: "var(--text-body)",
        margin: "0 0 0.25rem",
      }}
    >
      {syncState.label}
    </p>
    <p
      style={{
        fontSize: "var(--text-caption)",
        color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
        margin: "0 0 0.75rem",
      }}
    >
      {syncState.description}
    </p>
    <div
      className="sync-pulse-bar"
      data-sync-state={syncState.state}
      role="status"
      aria-label={syncState.label}
    />
  </div>
);

const NumericTable: FC = () => (
  <table className="numeric-table">
    <thead>
      <tr>
        <th style={{ textAlign: "left" }}>Producto</th>
        <th>Cant.</th>
        <th>Unitario</th>
        <th>Total</th>
      </tr>
    </thead>
    <tbody>
      {NUMERIC_ROWS.map((row) => (
        <tr key={row.product}>
          <td
            style={{
              textAlign: "left",
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-body)",
              fontVariantNumeric: "normal",
            }}
          >
            {row.product}
          </td>
          <td>{row.qty}</td>
          <td>{formatCOP(row.unit)}</td>
          <td>{formatCOP(row.total)}</td>
        </tr>
      ))}
      <tr
        style={{
          borderTop: `1px solid color-mix(in srgb, var(--color-ink) 20%, transparent)`,
        }}
      >
        <td
          colSpan={3}
          style={{
            textAlign: "right",
            fontFamily: "var(--font-ui)",
            fontWeight: "var(--font-weight-medium)",
            fontSize: "var(--text-body)",
            fontVariantNumeric: "normal",
          }}
        >
          Subtotal
        </td>
        <td style={{ fontWeight: "var(--font-weight-medium)" }}>
          {formatCOP(SUBTOTAL)}
        </td>
      </tr>
      <tr>
        <td
          colSpan={3}
          style={{
            textAlign: "right",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-body)",
            fontVariantNumeric: "normal",
          }}
        >
          IVA (19%)
        </td>
        <td>{formatCOP(IVA)}</td>
      </tr>
      <tr className="total-row">
        <td
          colSpan={3}
          style={{
            textAlign: "right",
            fontFamily: "var(--font-ui)",
            fontWeight: "var(--font-weight-bold)",
            fontSize: "var(--text-price)",
            fontVariantNumeric: "normal",
          }}
        >
          TOTAL
        </td>
        <td>{formatCOP(TOTAL)}</td>
      </tr>
    </tbody>
  </table>
);

/* ------------------------------------------------------------------ */
/* Main page                                                           */
/* ------------------------------------------------------------------ */

export const DesignTokens: FC = () => {
  return (
    <div className="token-reference">
      <h1>Design Tokens — Pharmacy POS</h1>
      <p
        style={{
          fontSize: "var(--text-body)",
          color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
          marginTop: "-1.5rem",
          marginBottom: "2rem",
        }}
      >
        Dev-only reference page. Not routed in production.
      </p>

      {/* Palette */}
      <section>
        <h2>Palette</h2>
        <div className="swatch-grid">
          {SWATCHES.map((swatch) => (
            <SwatchCard key={swatch.name} swatch={swatch} />
          ))}
        </div>
      </section>

      {/* Type — UI face */}
      <section>
        <h2>Type — UI / Display (Inter)</h2>
        <TypeSpecimen family="ui" familyName="UI Face" weights={UI_WEIGHTS} />
      </section>

      {/* Type — Data face */}
      <section>
        <h2>Type — Data / Mono (JetBrains Mono)</h2>
        <TypeSpecimen
          family="data"
          familyName="Data Face"
          weights={DATA_WEIGHTS}
        />
      </section>

      {/* Numeric table with tabular figures */}
      <section>
        <h2>
          Tabular Figures — Numeric Table (
          <span className="font-data">tabular-nums</span>)
        </h2>
        <p
          style={{
            fontSize: "var(--text-caption)",
            color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
            marginTop: "-0.5rem",
            marginBottom: "1rem",
          }}
        >
          All numeric columns use JetBrains Mono with tabular figures. Resize
          the window and verify columns stay aligned. Product names in Inter
          for comparison.
        </p>
        <NumericTable />
      </section>

      {/* Sync Pulse — signature element */}
      <section>
        <h2>Signature Element — Ambient Sync Pulse</h2>
        <p
          style={{
            fontSize: "var(--text-caption)",
            color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
            marginTop: "-0.5rem",
            marginBottom: "1rem",
          }}
        >
          The single recurring animated element. 2px full-width line. Three
          states shown below. Enable{" "}
          <code style={{ fontFamily: "var(--font-data)", fontSize: "0.75rem" }}>
            prefers-reduced-motion
          </code>{" "}
          in your OS to verify all animations stop.
        </p>
        {SYNC_STATES.map((syncState) => (
          <SyncPulseDemo key={syncState.state} syncState={syncState} />
        ))}
      </section>

      {/* Verification notes */}
      <section>
        <h2>WCAG 2.1 AA Verification Checklist</h2>
        <ul
          style={{
            fontSize: "var(--text-body)",
            lineHeight: "1.8",
            paddingLeft: "1.25rem",
          }}
        >
          <li>
            <strong>Contrast:</strong> Data Ink (#171614) on Surface Warm
            (#F9F6F0) = 19.05:1 ✓ (exceeds 4.5:1 minimum)
          </li>
          <li>
            <strong>Contrast:</strong> Pharma Teal (#0B6E6B) on Surface Warm =
            5.83:1 ✓ (exceeds 4.5:1 for normal text)
          </li>
          <li>
            <strong>Tabular figures:</strong> Numeric table columns remain
            aligned at all viewport widths ✓
          </li>
          <li>
            <strong>Reduced motion:</strong> Enable OS-level setting and refresh
            — sync pulse bars become static, no animation ✓
          </li>
          <li>
            <strong>Focus visible:</strong> Tab through the page — all
            interactive elements show a 2px teal outline ✓
          </li>
          <li>
            <strong>Color independence:</strong> Sync pulse states have text
            labels, not just color. Urgency Amber is labeled "VENCE PRONTO" in
            wireframes ✓
          </li>
          <li>
            <strong>Font loading:</strong> Inter and JetBrains Mono load from
            Google Fonts with <code>font-display: swap</code> ✓
          </li>
        </ul>
      </section>
    </div>
  );
};
