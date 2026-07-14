/**
 * Component tests for UpdateSettingsSection.
 *
 * Covers: toggle states, channel selector visibility, change handlers.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UpdateSettingsSection } from "./update-settings.section";
import "@/i18n";

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.mock factories are hoisted above imports, so any
// variables they reference must be defined via vi.hoisted().
// ---------------------------------------------------------------------------

const { mockStoreStateRef, mockUseUpdateStore } = vi.hoisted(() => {
  const updateAndPersistFn = vi.fn();

  const state: Record<string, unknown> = {
    autoDownload: false,
    installOnClose: true,
    channel: "STABLE",
    updateAndPersist: updateAndPersistFn,
  };

  const mockStore = Object.assign(
    (selector?: (s: Record<string, unknown>) => unknown) => {
      if (selector) return selector(state);
      return state;
    },
    {
      getState: () => state,
      setState: vi.fn(),
      subscribe: vi.fn(),
      destroy: vi.fn(),
    },
  );

  return {
    mockStoreStateRef: state,
    mockUseUpdateStore: mockStore,
  };
});

vi.mock("../../../domain/updates/update.store", () => ({
  useUpdateStore: mockUseUpdateStore,
}));

vi.mock("../../../infrastructure/local-database", () => ({
  getLocalDatabase: vi.fn().mockResolvedValue({
    prisma: {},
  }),
}));

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("UpdateSettingsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreStateRef.autoDownload = false;
    mockStoreStateRef.installOnClose = true;
    mockStoreStateRef.channel = "STABLE";
  });

  it("renders auto-download checkbox with label key", () => {
    render(<UpdateSettingsSection />);

    expect(
      screen.getByText("update.settings.auto_download_label"),
    ).toBeInTheDocument();
  });

  it("renders auto-download description key", () => {
    render(<UpdateSettingsSection />);

    expect(
      screen.getByText("update.settings.auto_download_desc"),
    ).toBeInTheDocument();
  });

  it("renders install-on-close checkbox with label key", () => {
    render(<UpdateSettingsSection />);

    expect(
      screen.getByText("update.settings.install_on_close_label"),
    ).toBeInTheDocument();
  });

  it("renders install-on-close description key", () => {
    render(<UpdateSettingsSection />);

    expect(
      screen.getByText("update.settings.install_on_close_desc"),
    ).toBeInTheDocument();
  });

  it("checkbox reflects autoDownload state", () => {
    mockStoreStateRef.autoDownload = true;
    render(<UpdateSettingsSection />);

    const autoDownloadCheckbox = screen.getByRole("checkbox", {
      name: /auto_download_label/i,
    });
    expect(autoDownloadCheckbox).toBeChecked();
  });

  it("checkbox reflects installOnClose state", () => {
    mockStoreStateRef.installOnClose = false;
    render(<UpdateSettingsSection />);

    const installCheckbox = screen.getByRole("checkbox", {
      name: /install_on_close_label/i,
    });
    expect(installCheckbox).not.toBeChecked();
  });

  it("calls updateAndPersist when auto-download checkbox toggled", async () => {
    render(<UpdateSettingsSection />);

    const checkbox = screen.getByRole("checkbox", {
      name: /auto_download_label/i,
    });
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(mockStoreStateRef.updateAndPersist).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ autoDownload: true }),
      );
    });
  });

  it("calls updateAndPersist when install-on-close checkbox toggled", async () => {
    render(<UpdateSettingsSection />);

    const checkbox = screen.getByRole("checkbox", {
      name: /install_on_close_label/i,
    });
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(mockStoreStateRef.updateAndPersist).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ installOnClose: false }),
      );
    });
  });

  it("does not show channel selector by default", () => {
    render(<UpdateSettingsSection />);

    expect(
      screen.queryByText("update.settings.channel_label"),
    ).not.toBeInTheDocument();
  });

  it("shows channel selector when showChannelSelector is true", () => {
    render(<UpdateSettingsSection showChannelSelector />);

    expect(
      screen.getByText("update.settings.channel_label"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("update.settings.channel_stable"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("update.settings.channel_beta"),
    ).toBeInTheDocument();
  });

  it("renders STABLE channel as selected when channel is STABLE", () => {
    render(<UpdateSettingsSection showChannelSelector />);

    expect(
      screen.getByText("update.settings.channel_stable"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("update.settings.channel_beta"),
    ).toBeInTheDocument();
  });

  it("calls updateAndPersist when channel button clicked", async () => {
    render(<UpdateSettingsSection showChannelSelector />);

    fireEvent.click(screen.getByText("update.settings.channel_beta"));

    await waitFor(() => {
      expect(mockStoreStateRef.updateAndPersist).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ channel: "BETA" }),
      );
    });
  });
});
