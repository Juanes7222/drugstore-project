/**
 * RoleGuard — declarative role-based UI gating.
 *
 * Conditionally renders children only when the current session's role
 * is among the allowed roles. This is a UX guard only — the real security
 * boundary is the server's role guard.
 *
 * Usage:
 *   <RoleGuard allow={['MANAGER', 'OWNER']}>
 *     <AdminButton />
 *   </RoleGuard>
 */
import { type FC, type ReactNode } from 'react';
import { RoleType } from '@pharmacy/shared-types';
import { useLocalSessionStore, hasMinRole } from '../../../domain/auth';

interface RoleGuardProps {
  allow: RoleType[];
  fallback?: ReactNode;
  children: ReactNode;
}

export const RoleGuard: FC<RoleGuardProps> = ({ allow, fallback = null, children }) => {
  const session = useLocalSessionStore((s) => s.session);

  if (!session) {
    return <>{fallback}</>;
  }

  const hasAccess = allow.some((role) => hasMinRole(session, role));

  if (!hasAccess) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};

/**
 * Higher-order component wrapper for RoleGuard.
 */
export const withRoleGuard =
  <P extends Record<string, unknown>>(allow: RoleType[], fallback?: ReactNode) =>
  (Component: FC<P>): FC<P> =>
  (props: P) =>
    (
      <RoleGuard allow={allow} fallback={fallback}>
        <Component {...props} />
      </RoleGuard>
    );
