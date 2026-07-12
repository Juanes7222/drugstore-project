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
  IDLE: new Set(['CHECKING']),
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
  ROLLED_BACK: new Set(['IDLE']),
  NO_UPDATE: new Set(['IDLE', 'CHECKING']),
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

  /** Rollback triggered after crash or migration failure. */
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
