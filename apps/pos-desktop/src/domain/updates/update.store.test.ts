/**
 * Tests for the update Zustand store.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { useUpdateStore } from "./update.store";

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
