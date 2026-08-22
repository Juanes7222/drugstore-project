import { describe, it, expect } from '@jest/globals';
import { JwtRefreshGuard } from './jwt-refresh.guard';

describe('JwtRefreshGuard', () => {
  it('is instantiable as an AuthGuard for the jwt-refresh strategy', () => {
    const guard = new JwtRefreshGuard();

    expect(guard).toBeInstanceOf(JwtRefreshGuard);
  });
});