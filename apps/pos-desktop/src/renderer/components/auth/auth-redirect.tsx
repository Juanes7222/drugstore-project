/**
 * AuthRedirect — route guard component.
 *
 * Redirects to the login page if there is no active session.
 * Wraps child components that require authentication.
 *
 * Usage:
 *   <AuthRedirect>
 *     <ProtectedPage />
 *   </AuthRedirect>
 */
import { type FC, type ReactNode, useEffect } from 'react';
import { useAppDispatch } from '@/store/hooks';
import { setActiveScreen } from '@/store/slices/ui-slice';
import { useLocalSessionStore } from '../../../domain/auth/local-session.store';

interface AuthRedirectProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export const AuthRedirect: FC<AuthRedirectProps> = ({
  children,
  fallback = null,
}) => {
  const dispatch = useAppDispatch();
  const session = useLocalSessionStore((s) => s.session);
  const isInitialized = useLocalSessionStore((s) => s.isInitialized);

  useEffect(() => {
    if (isInitialized && !session) {
      dispatch(setActiveScreen('login'));
    }
  }, [isInitialized, session, dispatch]);

  if (!session) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};

/**
 * Higher-order component wrapper.
 */
export const withAuth =
  <P extends Record<string, unknown>>(fallback?: ReactNode) =>
  (Component: FC<P>): FC<P> =>
  (props: P) =>
    (
      <AuthRedirect fallback={fallback}>
        <Component {...props} />
      </AuthRedirect>
    );
