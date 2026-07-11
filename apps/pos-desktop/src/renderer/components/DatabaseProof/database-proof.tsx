/**
 * Proof-of-concept component — Local Database E2E test.
 *
 * On mount, this component:
 *  1. Initialises the PGlite database (creates schema if first run).
 *  2. Inserts a single `Client` row.
 *  3. Reads it back and displays the result.
 *
 * This is strictly a foundation test, not a real UI component. It proves:
 *  - Tauri app-data path resolution (cross-platform IPC via `appLocalDataDir`)
 *  - PGlite in-process persistence (backed by IndexedDB in the webview)
 *  - The Prisma PGlite adapter wiring (`pglite-prisma-adapter`)
 *  - The generated local Prisma Client (from `@pharmacy/database/local`)
 *  - First-run schema bootstrap from the generated DDL
 */

import { useEffect, useState, type FC } from "react";
import { getLocalDatabase } from "@infra/local-database";
import type { PrismaClient } from "@pharmacy/database/local";

interface ProofState {
  phase: "initializing" | "inserting" | "reading" | "done" | "error";
  clientData: { id: string; fullName: string; identificationNumber: string } | null;
  error?: string;
}

const PLACEHOLDER_USER_ID = "00000000-0000-0000-0000-000000000001";
const TEST_CLIENT_ID = crypto.randomUUID();
const TEST_CLIENT = {
  id: TEST_CLIENT_ID,
  identificationType: "CC" as const,
  identificationNumber: "TEST-123456",
  fullName: "Cliente de Prueba — POC",
  email: "test@pharmacy-poc.local",
  phone: "3000000000",
};

export const DatabaseProof: FC = () => {
  const [state, setState] = useState<ProofState>({ phase: "initializing", clientData: null });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // ---- Phase 1: init ----
        setState({ phase: "initializing", clientData: null });
        const { prisma: rawPrisma } = await getLocalDatabase();
        const prisma = rawPrisma as PrismaClient;
        if (cancelled) return;

        // ---- Phase 2: insert ----
        setState({ phase: "inserting", clientData: null });
        const client = await prisma.client.create({
          data: {
            id: TEST_CLIENT.id,
            identificationType: TEST_CLIENT.identificationType,
            identificationNumber: TEST_CLIENT.identificationNumber,
            fullName: TEST_CLIENT.fullName,
            email: TEST_CLIENT.email,
            phone: TEST_CLIENT.phone,
            createdById: PLACEHOLDER_USER_ID,
          },
        });
        if (cancelled) return;

        setState({
          phase: "reading",
          clientData: { id: client.id, fullName: client.fullName, identificationNumber: client.identificationNumber },
        });

        // ---- Phase 3: read back ----
        const found = await prisma.client.findUnique({ where: { id: client.id } });
        if (cancelled) return;

        if (found) {
          setState({
            phase: "done",
            clientData: {
              id: found.id,
              fullName: found.fullName,
              identificationNumber: found.identificationNumber,
            },
          });
        } else {
          throw new Error("Client was inserted but could not be read back.");
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            phase: "error",
            clientData: null,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      style={{
        padding: "24px",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "14px",
        lineHeight: 1.6,
      }}
    >
      <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "16px" }}>
        Local Database — E2E Proof
      </h2>

      <PhaseLine phase="initializing" current={state.phase} label="Initialise PGlite + Prisma Client" />
      <PhaseLine phase="inserting" current={state.phase} label={`Insert Client "${TEST_CLIENT.fullName}"`} />
      <PhaseLine phase="reading" current={state.phase} label="Read back by ID" />

      {state.phase === "done" && state.clientData && (
        <div style={{ marginTop: "16px", padding: "12px", background: "#f0fdf4", borderRadius: "6px" }}>
          <p style={{ color: "#166534", fontWeight: 600, marginBottom: "8px" }}>✓ Success</p>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
            {JSON.stringify(state.clientData, null, 2)}
          </pre>
        </div>
      )}

      {state.phase === "error" && (
        <div style={{ marginTop: "16px", padding: "12px", background: "#fef2f2", borderRadius: "6px" }}>
          <p style={{ color: "#991b1b", fontWeight: 600, marginBottom: "8px" }}>✗ Error</p>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{state.error}</pre>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Helper — single phase status line
// ---------------------------------------------------------------------------

const PhaseLine: FC<{
  phase: ProofState["phase"];
  current: ProofState["phase"];
  label: string;
}> = ({ phase, current, label }) => {
  const isActive = current === phase;
  const isPast =
    ["initializing", "inserting", "reading", "done"].indexOf(current) >
    ["initializing", "inserting", "reading", "done"].indexOf(phase);
  const isError = current === "error";

  let indicator: string;
  if (isError) indicator = "—";
  else if (isPast || current === "done") indicator = "✓";
  else if (isActive) indicator = "→";
  else indicator = "○";

  const color = isError ? "#991b1b" : isPast || current === "done" ? "#166534" : isActive ? "#b45309" : "#9ca3af";

  return (
    <p style={{ color, margin: "4px 0" }}>
      <span style={{ marginRight: "8px", fontWeight: 700 }}>{indicator}</span>
      {label}
    </p>
  );
};
