/**
 * Local-versus-server reconciliation for the real-Tauri e2e suite.
 *
 * Why this exists
 * ---------------
 * The specs assert hand-picked facts, and a hand-picked fact list can only
 * catch what somebody already thought to look at. That is how a synced purchase
 * reception ended up with a $400,000 header and $0 items: the local reader
 * projected neither `subtotal` nor `taxAmount`, so there was nothing to compare
 * and the divergence was invisible to every assertion in the suite.
 *
 * So the rule here is inverted. Both sides are read at FULL width and diffed by
 * the union of their field names; anything present on one side and absent or
 * different on the other becomes a finding. A field nobody asserted is exactly
 * the interesting one.
 *
 * Verdicts
 * --------
 *  - `MISMATCH`     both sides have the field and the values disagree.
 *  - `ABSENT_*`     the field exists on one side only. Almost always a defect:
 *                    storage that dropped a column the domain requires.
 *  - `TOLERATED`    the values differ in a way the caller has justified, e.g.
 *                    a date compared by calendar day because the two stores
 *                    serialise an instant differently.
 *
 * Everything else is a finding, including ones nobody asked about.
 */

export type Verdict =
  "MISMATCH" | "ABSENT_SERVER" | "ABSENT_LOCAL" | "TOLERATED";

export interface Finding {
  /** What the row is, e.g. `PurchaseReceptionItem LOT-E2E-100`. */
  entity: string;
  field: string;
  local: string;
  server: string;
  verdict: Verdict;
  /** Why a tolerated difference is acceptable. */
  note?: string;
}

/** How a field is compared. */
export interface FieldRule {
  /** Money tolerates sub-cent noise; dates compare by instant unless noted. */
  kind?: "money" | "date" | "dateDay" | "text" | "number";
  /**
   * The field is expected to exist only on the POS side (or only on the server
   * side) — a local-only bookkeeping column, say. Returns the note to record.
   */
  localOnly?: string;
  serverOnly?: string;
  /** Justified difference. Return a reason, or undefined to report a mismatch. */
  tolerate?: (local: unknown, server: unknown) => string | undefined;
}

const MONEY_TOLERANCE = 0.005;

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

/** Render a value for a finding without losing `null`/`undefined` distinction. */
function show(value: unknown): string {
  if (value === undefined) return "<absent>";
  if (value === null) return "<null>";
  return String(value);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  // Prisma.Decimal and anything else with a toString of digits.
  const parsed = Number(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

function toMillis(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

/**
 * Compare one value pair.
 *
 * `tolerate` is consulted FIRST and its reason wins: a caller that has justified
 * a difference has declared it non-defective, so it must not be reported as a
 * MISMATCH. Reporting it as one would bury the real defects in noise.
 */
function compare(
  local: unknown,
  server: unknown,
  rule: FieldRule,
): { verdict: Verdict; note?: string } {
  const tolerated = rule.tolerate?.(local, server);
  if (tolerated) return { verdict: "TOLERATED", note: tolerated };

  const difference = same(local, server, rule);
  return difference
    ? { verdict: "MISMATCH", note: difference }
    : { verdict: "TOLERATED" };
}

/** The raw difference description for one value pair, or undefined when equal. */
function same(
  local: unknown,
  server: unknown,
  rule: FieldRule,
): string | undefined {
  switch (rule.kind) {
    case "money": {
      const l = toNumber(local);
      const s = toNumber(server);
      if (l === null || s === null) return undefined;
      return Math.abs(l - s) <= MONEY_TOLERANCE
        ? undefined
        : `${show(local)} vs ${show(server)}`;
    }
    case "number": {
      const l = toNumber(local);
      const s = toNumber(server);
      return l === s ? undefined : `${show(local)} vs ${show(server)}`;
    }
    case "date":
    case "dateDay": {
      const l = toMillis(local);
      const s = toMillis(server);
      if (l === null || s === null) return undefined;
      if (rule.kind === "date") {
        return l === s ? undefined : `${show(local)} vs ${show(server)}`;
      }
      const day = 24 * 60 * 60 * 1000;
      // Calendar-day comparison in UTC, so a local-midnight instant stored as
      // 05:00Z does not read as a different day.
      return Math.floor(l / day) === Math.floor(s / day)
        ? undefined
        : `${show(local)} vs ${show(server)}`;
    }
    default:
      return String(local) === String(server)
        ? undefined
        : `${show(local)} vs ${show(server)}`;
  }
}

/**
 * Diff one row against its counterpart across the union of both field names.
 */
export function reconcileRow(
  entity: string,
  local: Record<string, unknown>,
  server: Record<string, unknown>,
  rules: Record<string, FieldRule> = {},
): Finding[] {
  const fields = new Set([...Object.keys(local), ...Object.keys(server)]);
  const findings: Finding[] = [];

  for (const field of [...fields].sort()) {
    const rule = rules[field] ?? {};
    const l = local[field];
    const s = server[field];

    if (!present(s)) {
      if (rule.serverOnly) continue;
      findings.push({
        entity,
        field,
        local: show(l),
        server: "<absent>",
        verdict: present(l) ? "ABSENT_SERVER" : "TOLERATED",
        note:
          rule.localOnly ??
          "present on the POS, absent on the server: storage dropped it",
      });
      continue;
    }

    if (!present(l)) {
      // `serverOnly` names a column the POS simply does not carry (a display
      // join, say). It has to suppress this branch too, not only the one above:
      // a field present solely on the server is not "never written locally", it
      // is out of contract.
      if (rule.localOnly) continue;
      if (rule.serverOnly) continue;
      findings.push({
        entity,
        field,
        local: "<absent>",
        server: show(s),
        verdict: "ABSENT_LOCAL",
        note: "present on the server, never written locally",
      });
      continue;
    }

    const difference = compare(l, s, rule);
    findings.push({
      entity,
      field,
      local: show(l),
      server: show(s),
      verdict: difference.verdict,
      note: difference.note,
    });
  }

  return findings;
}

/** Findings a suite should treat as a failure. */
export function defects(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.verdict !== "TOLERATED");
}

/** A report that names every discrepancy, not just the failing ones. */
export function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return "no differences";
  return findings
    .map((f) => {
      const note = f.note ? ` — ${f.note}` : "";
      return `${f.verdict.padEnd(15)} ${f.entity}.${f.field}: local=${f.local} server=${f.server}${note}`;
    })
    .join("\n");
}

/** Throw with the full discrepancy list, so one run reports all of them. */
export function assertNoDefects(findings: Finding[], scope: string): void {
  const bad = defects(findings);
  if (bad.length === 0) return;
  throw new Error(
    `${bad.length} local/server discrepancy(ies) in ${scope}:\n` +
      formatFindings(bad),
  );
}
