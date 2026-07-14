/**
 * Component tests for DatabaseProof.
 *
 * Covers: badge text display, toggle visibility, phase rendering.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DatabaseProof } from "./database-proof";
import "@/i18n";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@infra/local-database", () => ({
  getLocalDatabase: vi.fn().mockResolvedValue({
    prisma: {
      client: {
        create: vi.fn().mockRejectedValue(new Error("Not connected")),
        findUnique: vi.fn(),
      },
    },
  }),
}));

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("DatabaseProof", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the title text", () => {
    render(<DatabaseProof />);

    expect(
      screen.getByText("Local Database — E2E Proof"),
    ).toBeInTheDocument();
  });

  it("shows the initializing phase line", () => {
    render(<DatabaseProof />);

    expect(
      screen.getByText(/Initialise PGlite \+ Prisma Client/),
    ).toBeInTheDocument();
  });

  it("shows the inserting phase line", () => {
    render(<DatabaseProof />);

    expect(
      screen.getByText(/Insert Client/),
    ).toBeInTheDocument();
  });

  it("shows the reading phase line", () => {
    render(<DatabaseProof />);

    expect(
      screen.getByText(/Read back by ID/),
    ).toBeInTheDocument();
  });
});
