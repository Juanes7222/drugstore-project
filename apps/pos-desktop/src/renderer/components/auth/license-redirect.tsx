/**
 * LicenseRedirect — route guard that checks license status.
 *
 * Redirects to the license status page if the license is invalid or expiring.
 * Wraps child components that require a valid license.
 *
 * Usage:
 *   <LicenseRedirect>
 *     <ProtectedPage />
 *   </LicenseRedirect>
 */
import { type FC, type ReactNode, useEffect, useState } from 'react';
import { useAppDispatch } from '@/store/hooks';
import { setActiveScreen } from '@/store/slices/ui-slice';

interface LicenseRedirectProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export const LicenseRedirect: FC<LicenseRedirectProps> = ({
  children,
  fallback = null,
}) => {
  const dispatch = useAppDispatch();
  const [licenseValid, setLicenseValid] = useState<boolean | null>(null);

  useEffect(() => {
    const checkLicense = async () => {
      try {
        // In production, call the license check endpoint
        const response = await fetch('/api/licensing/status');
        const data = await response.json();
        setLicenseValid(data.status === 'ACTIVE' || data.status === 'GRACE_PERIOD');
      } catch {
        // If we can't check, assume valid (offline mode)
        setLicenseValid(true);
      }
    };

    checkLicense();
  }, []);

  if (licenseValid === false) {
    dispatch(setActiveScreen('recovery'));
    return <>{fallback}</>;
  }

  return <>{children}</>;
};
