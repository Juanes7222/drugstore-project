/**
 * Hook that returns the elapsed time since a given ISO timestamp as HH:mm.
 *
 * Used by the cash-shift header to show how long the current turno has been
 * open. Updates once per minute while the shift is open.
 */
import { useEffect, useState } from "react";

const pad = (value: number): string => String(value).padStart(2, "0");

const computeElapsed = (openedAt: string): string => {
  const start = new Date(openedAt).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - start);
  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${pad(hours)}:${pad(minutes)}`;
};

export const useElapsedTime = (
  openedAt: string,
  isRunning: boolean,
): string => {
  const [elapsed, setElapsed] = useState(() => computeElapsed(openedAt));

  useEffect(() => {
    if (!isRunning) {
      return undefined;
    }

    setElapsed(computeElapsed(openedAt));

    const interval = setInterval(() => {
      setElapsed(computeElapsed(openedAt));
    }, 60000);

    return () => clearInterval(interval);
  }, [openedAt, isRunning]);

  return elapsed;
};
