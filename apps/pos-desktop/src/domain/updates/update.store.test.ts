/**
 * Tests for the update Zustand store.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { useUpdateStore, getUpdateStoreState } from "./update.store";

beforeEach(() => {
  useUpdateStore.setState({
    currentVersion: "0.0.0",
    lastCheckAt: null,
    lastAvailableVersion: null,
    lastAvailableType: null,
    lastAvailableChangelog: null,
    lastAvailableDownloadUrl: null,
    lastAvailableFileSize: null,
    downloadStatus: null,
    downloadProgress: 0,
    downloadSpeed: 0,
    installStatus: null,
    lastErrorMessage: null,
    userDismissedVersion: null,
    channel: "STABLE",
    autoDownload: true,
    installOnClose: true,
    stateMachineState: "IDLE",
    showUpdateModal: false,
    showProgressOverlay: false,
  } as any);
});

describe("initial state", () => {
  it("starts with IDLE state machine state", () => {
    expect(useUpdateStore.getState().stateMachineState).toBe("IDLE");
  });

  it("starts with default app version", () => {
    expect(useUpdateStore.getState().currentVersion).toBe("0.0.0");
  });

  it("starts with no last check", () => {
    expect(useUpdateStore.getState().lastCheckAt).toBeNull();
  });

  it("starts with STABLE channel", () => {
    expect(useUpdateStore.getState().channel).toBe("STABLE");
  });

  it("starts with autoDownload and installOnClose enabled", () => {
    const state = useUpdateStore.getState();
    expect(state.autoDownload).toBe(true);
    expect(state.installOnClose).toBe(true);
  });
});

describe("setStateMachineState", () => {
  it("updates the state machine state", () => {
    useUpdateStore.getState().setStateMachineState("DOWNLOADING");

    expect(useUpdateStore.getState().stateMachineState).toBe("DOWNLOADING");
  });
});

describe("clearError", () => {
  it("clears the last error message", () => {
    useUpdateStore.setState({ lastErrorMessage: "Some error" });
    useUpdateStore.getState().clearError();

    expect(useUpdateStore.getState().lastErrorMessage).toBeNull();
  });
});

describe("dismissVersion", () => {
  it("records the dismissed version", () => {
    useUpdateStore.getState().dismissVersion("2.0.0");

    expect(useUpdateStore.getState().userDismissedVersion).toBe("2.0.0");
  });

  it("overwrites a previous dismissal", () => {
    useUpdateStore.getState().dismissVersion("1.0.0");
    useUpdateStore.getState().dismissVersion("2.0.0");

    expect(useUpdateStore.getState().userDismissedVersion).toBe("2.0.0");
  });
});

describe("setShowUpdateModal", () => {
  it("shows the modal", () => {
    useUpdateStore.getState().setShowUpdateModal(true);

    expect(useUpdateStore.getState().showUpdateModal).toBe(true);
  });

  it("hides the modal", () => {
    useUpdateStore.getState().setShowUpdateModal(true);
    useUpdateStore.getState().setShowUpdateModal(false);

    expect(useUpdateStore.getState().showUpdateModal).toBe(false);
  });
});

describe("setShowProgressOverlay", () => {
  it("shows the progress overlay", () => {
    useUpdateStore.getState().setShowProgressOverlay(true);

    expect(useUpdateStore.getState().showProgressOverlay).toBe(true);
  });
});

describe("setDownloadProgress", () => {
  it("sets progress percentage and speed", () => {
    useUpdateStore.getState().setDownloadProgress(50, 1024000);

    const state = useUpdateStore.getState();
    expect(state.downloadProgress).toBe(50);
    expect(state.downloadSpeed).toBe(1024000);
  });
});

describe("setDownloadStatus", () => {
  it("sets the download status", () => {
    useUpdateStore.getState().setDownloadStatus("DOWNLOADING");

    expect(useUpdateStore.getState().downloadStatus).toBe("DOWNLOADING");
  });
});

describe("setInstallStatus", () => {
  it("sets the install status", () => {
    useUpdateStore.getState().setInstallStatus("INSTALLING");

    expect(useUpdateStore.getState().installStatus).toBe("INSTALLING");
  });
});

describe("hydrateFromDb", () => {
  it("swallows error and logs warning when DB query fails", async () => {
    const mockPrisma = {
      updateState: {
        findUnique: vi.fn().mockRejectedValue(new Error("DB down")),
        create: vi.fn(),
      },
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await useUpdateStore.getState().hydrateFromDb(mockPrisma);

    expect(warnSpy).toHaveBeenCalledWith(
      "[update.store] Failed to hydrate from DB:",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("creates default singleton row when no row exists in DB", async () => {
    const mockPrisma = {
      updateState: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
    };

    await useUpdateStore.getState().hydrateFromDb(mockPrisma);

    expect(mockPrisma.updateState.findUnique).toHaveBeenCalledWith({
      where: { id: "singleton" },
    });
    expect(mockPrisma.updateState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: "singleton" }),
    });
  });

  it("hydrates store state from existing DB row", async () => {
    const dbRow = {
      currentVersion: "2.0.0",
      lastCheckAt: new Date("2026-01-01"),
      lastAvailableVersion: "3.0.0",
      lastAvailableType: "MAJOR",
      lastAvailableChangelog: "Big update",
      lastAvailableDownloadUrl: "https://example.com/update.bin",
      lastAvailableFileSize: 1024000,
      downloadStatus: "DOWNLOADED",
      downloadProgress: 100,
      installStatus: "INSTALLED",
      lastErrorMessage: null,
      userDismissedVersion: null,
      channel: "BETA",
      autoDownload: false,
      installOnClose: false,
    };

    const mockPrisma = {
      updateState: {
        findUnique: vi.fn().mockResolvedValue(dbRow),
        create: vi.fn(),
      },
    };

    await useUpdateStore.getState().hydrateFromDb(mockPrisma);

    expect(mockPrisma.updateState.create).not.toHaveBeenCalled();
    expect(useUpdateStore.getState().currentVersion).toBe("2.0.0");
    expect(useUpdateStore.getState().channel).toBe("BETA");
  });
});

describe("persistToDb", () => {
  it("calls upsert with current store state", async () => {
    const mockPrisma = {
      updateState: {
        upsert: vi.fn().mockResolvedValue({}),
      },
    };

    await useUpdateStore.getState().persistToDb(mockPrisma);

    expect(mockPrisma.updateState.upsert).toHaveBeenCalledWith({
      where: { id: "singleton" },
      update: expect.objectContaining({ currentVersion: "0.0.0" }),
      create: expect.objectContaining({ id: "singleton" }),
    });
  });
});

describe("updateAndPersist", () => {
  it("updates state and persists to DB", async () => {
    const mockPrisma = {
      updateState: {
        upsert: vi.fn().mockResolvedValue({}),
      },
    };

    await useUpdateStore
      .getState()
      .updateAndPersist(mockPrisma, { currentVersion: "2.0.0" });

    expect(useUpdateStore.getState().currentVersion).toBe("2.0.0");
    expect(mockPrisma.updateState.upsert).toHaveBeenCalled();
  });

  it("swallows DB error and logs warning", async () => {
    const mockPrisma = {
      updateState: {
        upsert: vi.fn().mockRejectedValue(new Error("DB fail")),
      },
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await useUpdateStore
      .getState()
      .updateAndPersist(mockPrisma, { currentVersion: "3.0.0" });

    expect(warnSpy).toHaveBeenCalledWith(
      "[update.store] Failed to persist to DB:",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});

describe("getUpdateStoreState", () => {
  it("returns current store state", () => {
    const state = getUpdateStoreState();

    expect(state).toHaveProperty("currentVersion");
    expect(state).toHaveProperty("stateMachineState", "IDLE");
  });
});
