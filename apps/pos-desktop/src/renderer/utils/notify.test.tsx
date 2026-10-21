/**
 * Unit tests for the notify wrapper (sileo toast system).
 *
 * Covers: default semantic icons per state, default durations per state,
 * explicit overrides (icon null opt-out, custom duration), and the action
 * variant's button wiring.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const sileoMock = vi.hoisted(() => ({
  success: vi.fn((_opts: unknown) => "success-id"),
  error: vi.fn((_opts: unknown) => "error-id"),
  warning: vi.fn((_opts: unknown) => "warning-id"),
  info: vi.fn((_opts: unknown) => "info-id"),
  action: vi.fn((_opts: unknown) => "action-id"),
  show: vi.fn((_opts: unknown) => "show-id"),
  dismiss: vi.fn(),
  clear: vi.fn(),
}));

vi.mock("sileo", () => ({ sileo: sileoMock }));

import { notify } from "./notify";

describe("notify (sileo wrapper)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("success passes the default semantic icon and 4000ms duration", () => {
    notify.success({ title: "Venta completada" });

    expect(sileoMock.success).toHaveBeenCalledTimes(1);
    const opts = sileoMock.success.mock.calls[0][0] as {
      title: string;
      duration: number | null;
      icon: unknown;
    };
    expect(opts.title).toBe("Venta completada");
    expect(opts.duration).toBe(4000);
    // Default icon is a React element (CheckCircle), not undefined.
    expect(opts.icon).not.toBeNull();
    expect(opts.icon).toBeDefined();
  });

  it("error uses the longer 8000ms default duration", () => {
    notify.error({ title: "Fallo de sincronización" });

    const opts = sileoMock.error.mock.calls[0][0] as {
      duration: number | null;
    };
    expect(opts.duration).toBe(8000);
  });

  it("warning uses 6000ms and info 4000ms defaults", () => {
    notify.warning({ title: "Stock bajo" });
    notify.info({ title: "Sin conexión" });

    expect(
      (sileoMock.warning.mock.calls[0][0] as { duration: number | null })
        .duration,
    ).toBe(6000);
    expect(
      (sileoMock.info.mock.calls[0][0] as { duration: number | null }).duration,
    ).toBe(4000);
  });

  it("explicit icon null opts out of the default icon", () => {
    notify.success({ title: "Sin icono", icon: null });

    const opts = sileoMock.success.mock.calls[0][0] as { icon: unknown };
    expect(opts.icon).toBeNull();
  });

  it("explicit duration overrides the type default", () => {
    notify.error({ title: "Persistente", duration: null });

    const opts = sileoMock.error.mock.calls[0][0] as {
      duration: number | null;
    };
    expect(opts.duration).toBeNull();
  });

  it("action wires the button and stays persistent by default", () => {
    const onClick = vi.fn();
    notify.action({
      title: "Venta restringida",
      action: { title: "Verificar", onClick },
    });

    const opts = sileoMock.action.mock.calls[0][0] as {
      duration: number | null;
      button?: { title: string; onClick: () => void };
    };
    expect(opts.duration).toBeNull();
    expect(opts.button?.title).toBe("Verificar");
  });

  it("dismiss delegates to sileo.dismiss with the toast id", () => {
    notify.dismiss("toast-1");
    expect(sileoMock.dismiss).toHaveBeenCalledWith("toast-1");
  });
});
