/**
 * Fetch with bounded retries for transient network failures.
 *
 * Boot-critical static assets (PGlite's ~10 MB WASM binary and ~6 MB data
 * bundle) are downloaded over HTTP from the dev-server origin. During
 * multi-station development those responses occasionally die mid-body when
 * the dev server restarts on a watched-file change or an intermediary resets
 * the TCP connection. A single transient reset must never abort application
 * boot, so this helper retries network-level failures with exponential
 * backoff before surfacing the error.
 */

/** Total attempts (first try included) when the caller does not specify one. */
export const DEFAULT_FETCH_RETRY_ATTEMPTS = 4;

const DEFAULT_BASE_DELAY_MS = 300;
const DEFAULT_MAX_DELAY_MS = 2500;

/** Information about a single scheduled retry, for caller-side logging. */
export interface FetchRetryInfo {
  url: string;
  /** Attempt number that just failed (1-based). */
  attempt: number;
  /** Total attempts that will be made. */
  attempts: number;
  /** Milliseconds the next retry will wait. */
  delayMs: number;
  error: unknown;
}

export interface FetchWithRetryOptions {
  /** Total attempts including the first one. Defaults to 4. */
  attempts?: number;
  /** Backoff base in ms; doubled on every subsequent retry. Defaults to 300. */
  baseDelayMs?: number;
  /** Upper bound for a single backoff interval in ms. Defaults to 2500. */
  maxDelayMs?: number;
  /** Abort signal forwarded to every attempt; firing it cancels retries. */
  signal?: AbortSignal;
  /** Called before each scheduled retry so callers can log the delay. */
  onRetry?: (info: FetchRetryInfo) => void;
}

/**
 * Network-level failures surface as `TypeError` from fetch (connection
 * reset, socket closed mid-body, DNS failure). HTTP error statuses are NOT
 * retried here — they are deterministic server answers, and the caller
 * inspects `response.ok` itself.
 */
function isTransientNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveDelay, rejectDelay) => {
    if (signal?.aborted) {
      rejectDelay(signal.reason);
      return;
    }
    // Local alias so strict null checks keep the narrowed type inside the
    // abort callback (closure widening defeats control-flow analysis).
    const abortSignal = signal;
    const onAbort = () => {
      clearTimeout(timer);
      rejectDelay(abortSignal?.reason);
    };
    const timer = setTimeout(() => {
      abortSignal?.removeEventListener('abort', onAbort);
      resolveDelay();
    }, ms);
    abortSignal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Fetch `url` and return the `Response`, retrying transient network errors.
 *
 * Only network-level failures (`TypeError`) are retried; non-OK HTTP
 * statuses are returned untouched so the calling feature can branch on
 * them. Throws the last observed error once attempts are exhausted or the
 * abort signal fires.
 */
export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const attempts = options.attempts ?? DEFAULT_FETCH_RETRY_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetch(url, { signal: options.signal });
    } catch (error) {
      const isLastAttempt = attempt === attempts;
      if (
        options.signal?.aborted ||
        isLastAttempt ||
        !isTransientNetworkError(error)
      ) {
        throw error;
      }
      const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      options.onRetry?.({ url, attempt, attempts, delayMs, error });
      await delay(delayMs, options.signal);
    }
  }

  // Unreachable: the loop either returns a Response or throws.
  throw new TypeError(`fetchWithRetry exhausted attempts for ${url}`);
}
