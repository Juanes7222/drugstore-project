/**
 * Hook that returns the browser's online/offline state.
 *
 * Used by the AppShell to drive the Ambient Sync Pulse: when the browser
 * reports itself offline, the pulse switches to the Sync Slate "offline"
 * treatment defined in design-system.md.
 */
import { useEffect, useState } from "react";

export const useOnlineStatus = (): boolean => {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
};
