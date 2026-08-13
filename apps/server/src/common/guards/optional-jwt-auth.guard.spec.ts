import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

describe('OptionalJwtAuthGuard', () => {
  const guard = new OptionalJwtAuthGuard();

  const mockContext = {} as never;

  it('returns the authenticated user when the token is valid', () => {
    const user = { id: 'user-1', role: 'OWNER', subscriptionId: 'sub_default' };

    const result = guard.handleRequest(
      null,
      user,
      undefined,
      mockContext,
      undefined,
    );

    expect(result).toEqual(user);
  });

  it('returns null (never throws) when no token is present', () => {
    const result = guard.handleRequest(
      null,
      false,
      { message: 'No auth token' },
      mockContext,
      undefined,
    );

    expect(result).toBeNull();
  });

  it('returns null (never throws) when the token is invalid', () => {
    const err = new Error('jwt expired');

    const result = guard.handleRequest(
      err,
      false,
      { message: 'jwt expired' },
      mockContext,
      undefined,
    );

    expect(result).toBeNull();
  });

  it('returns null (never throws) when the session is revoked', () => {
    const err = new Error('Session revoked');

    const result = guard.handleRequest(
      err,
      false,
      { message: 'Session revoked' },
      mockContext,
      undefined,
    );

    expect(result).toBeNull();
  });
});
