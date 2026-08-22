/**
 * Scan/action feedback sounds via the Web Audio API.
 *
 * A barcode scanner in a noisy pharmacy gives no visual cue on its own —
 * the cashier's eyes stay on the customer or the shelf. This module plays
 * a short, distinct tone per outcome so a successful add is confirmed by
 * ear and a failed lookup (product not found, incomplete data) is signalled
 * without reading an error box.
 *
 * Uses a lazily-created AudioContext (browsers require a user gesture to
 * start one; the first keypress/scan provides it). All playback is wrapped
 * in try/catch — audio is a nicety, never a dependency, and jsdom has no
 * AudioContext at all.
 *
 * The caller is responsible for respecting the user's `soundEnabled`
 * preference; this module only plays what it is asked to.
 */

export type ScanFeedbackKind = "success" | "error";

let audioContext: AudioContext | null = null;

const getAudioContext = (): AudioContext | null => {
  try {
    if (!audioContext) {
      audioContext = new AudioContext();
    }
    if (audioContext.state === "suspended") {
      void audioContext.resume();
    }
    return audioContext;
  } catch {
    return null;
  }
};

const playTone = (
  context: AudioContext,
  frequency: number,
  durationMs: number,
  delayMs = 0,
): void => {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  oscillator.connect(gain);
  gain.connect(context.destination);

  const startAt = context.currentTime + delayMs;
  const endAt = startAt + durationMs / 1000;

  // Sharp attack, quick decay — reads as a "beep", not a tone.
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.15, startAt + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

  oscillator.start(startAt);
  oscillator.stop(endAt + 0.02);
};

/**
 * Play the outcome sound for a scan or keyboard action.
 *
 * - success: single high beep (880 Hz) — item added, cart held/recalled
 * - error: double low beep (220 Hz) — product not found, nothing to repeat
 *
 * Silently no-ops when the Web Audio API is unavailable.
 */
export function playScanFeedbackSound(kind: ScanFeedbackKind): void {
  const context = getAudioContext();
  if (!context) return;

  try {
    if (kind === "success") {
      playTone(context, 880, 70);
    } else {
      playTone(context, 220, 90, 0);
      playTone(context, 220, 90, 120);
    }
  } catch {
    // Audio failure must never break the sale flow.
  }
}