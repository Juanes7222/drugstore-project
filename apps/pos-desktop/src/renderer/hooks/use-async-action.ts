/**
 * useAsyncAction — generic async action runner with loading/error state.
 *
 * Reduces the pattern:
 *   const [isLoading, setIsLoading] = useState(false);
 *   const [error, setError] = useState<string | null>(null);
 *
 * To one call. run() returns { success: true, data } | { success: false }
 * so callers know immediately if the operation succeeded.
 *
 * @category Hook
 */

import { useState, useCallback } from 'react';

export type AsyncActionResult<T> =
  | { success: true; data: T }
  | { success: false };

export interface UseAsyncActionReturn {
  isLoading: boolean;
  error: string | null;
  run: <T>(fn: () => Promise<T>) => Promise<AsyncActionResult<T>>;
  reset: () => void;
}

export function useAsyncAction(): UseAsyncActionReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T>(fn: () => Promise<T>): Promise<AsyncActionResult<T>> => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fn();
      return { success: true as const, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      return { success: false };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setIsLoading(false);
    setError(null);
  }, []);

  return { isLoading, error, run, reset };
}
