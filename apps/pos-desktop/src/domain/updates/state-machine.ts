/**
 * Update state machine for the POS desktop auto-update module.
 *
 * Models the entire update lifecycle as a deterministic finite-state machine.
 * Every state transition is an explicit method, making the legal flow visible
 * at a glance and preventing illegal transitions at compile time.
 *
 * States mirror UpdateStateMachine enum from @pharmacy/shared-types but are
 * defined here as a plain union so the domain module has zero compile-time
 * dependency on the shared package for its core logic (the shared enums are
 * used at the integration boundaries: service, store, API).
 */

// ---------------------------------------------------------------------------
// State definition
// ---------------------------------------------------------------------------

export type UpdateState =
  | 'IDLE'
  | 'CHECKING'
  | 'UPDATE_AVAILABLE'
  | 'DOWNLOADING'
  | 'DOWNLOAD_PAUSED'
  | 'DOWNLOAD_FAILED'
  | 'READY_TO_INSTALL'
  | 'INSTALLING'
  | 'INSTALL_FAILED'
  | 'INSTALLED_PENDING_RESTART'
  | 'INSTALLED_VERIFIED'
  | 'ROLLED_BACK'
  | 'NO_UPDATE'
  | 'CHECK_FAILED';

// ---------------------------------------------------------------------------
// Legal transitions (one-directional map)
// ---------------------------------------------------------------------------

const TRANSITIONS: Record<UpdateState, ReadonlySet<UpdateState>> = {
  // ROLLED_BACK is reachable from IDLE because startup crash-loop recovery is
  // precisely the rollback that happens when NO update cycle is in progress in
  // this process: the machine adopts the rolled-back posture from persisted
  // evidence (crash counter), keeping the invariant that the state records
  // which phase produced the current binary. Driving the fake path
  // IDLE -> CHECKING -> ROLLED_BACK instead would emit spurious CHECKING
  // transitions to UI listeners for a check that never ran.
  IDLE: new Set(['CHECKING', 'ROLLED_BACK']),
  CHECKING: new Set(['UPDATE_AVAILABLE', 'NO_UPDATE', 'CHECK_FAILED', 'IDLE']),
  UPDATE_AVAILABLE: new Set(['DOWNLOADING', 'IDLE']),
  DOWNLOADING: new Set([
    'DOWNLOAD_PAUSED',
    'DOWNLOAD_FAILED',
    'READY_TO_INSTALL',
    'UPDATE_AVAILABLE',
  ]),
  DOWNLOAD_PAUSED: new Set(['DOWNLOADING', 'DOWNLOAD_FAILED', 'UPDATE_AVAILABLE']),
  DOWNLOAD_FAILED: new Set(['DOWNLOADING', 'IDLE']),
  READY_TO_INSTALL: new Set(['INSTALLING', 'UPDATE_AVAILABLE']),
  INSTALLING: new Set<UpdateState>([
    'INSTALLED_PENDING_RESTART',
    'INSTALL_FAILED',
    'ROLLED_BACK',
  ]),
  INSTALLED_PENDING_RESTART: new Set(['INSTALLED_VERIFIED', 'ROLLED_BACK']),
  INSTALL_FAILED: new Set(['IDLE', 'DOWNLOADING']),
  INSTALLED_VERIFIED: new Set(['IDLE']),
  // CHECKING allowed so a session that entered ROLLED_BACK at startup can
  // still look for updates again; without it the machine would dead-end
  // until restart.
  ROLLED_BACK: new Set(['IDLE', 'CHECKING']),
  NO_UPDATE: new Set(['IDLE', 'CHECKING', 'ROLLED_BACK']),
  CHECK_FAILED: new Set(['IDLE', 'CHECKING']),
};

// Additional synthetic state for internal use during install sequence
export type InstallOutcome =
  | 'INSTALLED_PENDING_RESTART'
  | 'INSTALL_FAILED'
  | 'ROLLED_BACK';

// ---------------------------------------------------------------------------
// Exception
// ---------------------------------------------------------------------------

export class IllegalStateTransitionException extends Error {
  constructor(from: UpdateState, to: UpdateState) {
    super(
      `Illegal update-state transition: ${from} -> ${to}. ` +
        `Legal targets: ${[...TRANSITIONS[from]].join(', ')}`,
    );
    this.name = 'IllegalStateTransitionException';
  }
}

// ---------------------------------------------------------------------------
// State machine class
// ---------------------------------------------------------------------------

export class UpdateStateMachine {
  private _state: UpdateState = 'IDLE';
  private listeners: Array<(state: UpdateState, previous: UpdateState) => void> = [];

  /** The current machine state. */
  get state(): UpdateState {
    return this._state;
  }

  /** Reset to IDLE — only legal from terminal or error states. */
  reset(): void {
    this.transitionTo('IDLE');
  }

  /** Begin an update check cycle. */
  startCheck(): void {
    this.transitionTo('CHECKING');
  }

  /** Server responded with an available update. */
  updateAvailable(): void {
    this.transitionTo('UPDATE_AVAILABLE');
  }

  /** Server responded with no update available. */
  noUpdate(): void {
    this.transitionTo('NO_UPDATE');
  }

  /** Server check failed (network, auth, etc.). */
  checkFailed(): void {
    this.transitionTo('CHECK_FAILED');
  }

  /** User dismissed the available update. */
  dismissUpdate(): void {
    this.transitionTo('IDLE');
  }

  /** Download has started. */
  startDownload(): void {
    this.transitionTo('DOWNLOADING');
  }

  /** Download was paused by the user or system. */
  pauseDownload(): void {
    this.transitionTo('DOWNLOAD_PAUSED');
  }

  /** Download resumed after being paused. */
  resumeDownload(): void {
    this.transitionTo('DOWNLOADING');
  }

  /** Download completed successfully. */
  downloadComplete(): void {
    this.transitionTo('READY_TO_INSTALL');
  }

  /** Download failed with an error. */
  downloadFailed(): void {
    this.transitionTo('DOWNLOAD_FAILED');
  }

  /** Retry download after a failure. */
  retryDownload(): void {
    this.transitionTo('DOWNLOADING');
  }

  /** Begin the install sequence. Takes optional pre-condition checks. */
  startInstall(): void {
    this.transitionTo('INSTALLING');
  }

  /** Install completed; pending app restart. */
  installPendingRestart(): void {
    this.transitionTo('INSTALLED_PENDING_RESTART');
  }

  /** New version verified as running correctly after restart. */
  verifyInstall(): void {
    this.transitionTo('INSTALLED_VERIFIED');
  }

  /**
   * Rollback triggered after crash or migration failure. Legal both
   * mid-cycle (INSTALLING / INSTALLED_PENDING_RESTART) and from IDLE,
   * where it records startup crash-loop recovery of a previous cycle.
   */
  rollback(): void {
    this.transitionTo('ROLLED_BACK');
  }

  /** Mark the update as re-available (e.g. when re-checking from IDLE). */
  reCheck(state: UpdateState): void {
    this.transitionTo(state);
  }

  // -----------------------------------------------------------------------
  // Listener management
  // -----------------------------------------------------------------------

  /**
   * Subscribe to state transitions. Returns an unsubscribe function.
   * The callback receives (newState, previousState).
   */
  onTransition(
    listener: (state: UpdateState, previous: UpdateState) => void,
  ): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private transitionTo(target: UpdateState): void {
    // Idempotent: callers (rollback-detector, React StrictMode double-mount)
    // may invoke rollback() when already in ROLLED_BACK. Treat as no-op
    // instead of throwing IllegalStateTransitionException which surfaces as
    // "Sentinel check failed" warnings and poisons the crash-loop signal.
    if (this._state === target) return;

    const allowed = TRANSITIONS[this._state];
    if (!allowed.has(target)) {
      throw new IllegalStateTransitionException(this._state, target);
    }

    const previous = this._state;
    this._state = target;
    for (const listener of this.listeners) {
      try {
        listener(this._state, previous);
      } catch {
        // Swallow listener errors so a bad subscriber never breaks the FSM.
      }
    }
  }
}
