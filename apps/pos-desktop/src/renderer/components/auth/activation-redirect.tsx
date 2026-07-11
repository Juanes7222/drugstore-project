/**
 * ActivationRedirect — route guard that checks if the workstation is activated.
 *
 * Redirects to the activation page if the workstation has no license.
 * Wraps child components that require an activated workstation.
 */
import { type FC, type ReactNode, useEffect, useState } from 'react';
import { useAppDispatch } from '@/store/hooks';
import { setActiveScreen } from '@/store/slices/ui-slice';

interface ActivationRedirectProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export const ActivationRedirect: FC<ActivationRedirectProps> = ({
  children,
  fallback = null,
}) => {
  const dispatch = useAppDispatch();
  const [isActivated, setIsActivated] = useState<boolean | null>(null);

  useEffect(() => {
    const checkActivation = async () => {
      try {
        // In production, check local storage for activation token
        const activationToken = localStorage.getItem('activationToken');
        if (!activationToken) {
          dispatch(setActiveScreen('recovery'));
          setIsActivated(false);
          return;
        }
        setIsActivated(true);
      } catch {
        setIsActivated(false);
        dispatch(setActiveScreen('recovery'));
      }
    };

    checkActivation();
  }, [dispatch]);

  if (!isActivated) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};
