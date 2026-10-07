jest.mock('../services/verification-token.service', () => ({
  VerificationTokenService: class {},
}));

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { VerificationTokenCleanupJob } from './verification-token-cleanup.job';
import { VerificationTokenService } from '../services/verification-token.service';

describe('VerificationTokenCleanupJob', () => {
  let purgeExpired: jest.Mock;
  let job: VerificationTokenCleanupJob;

  beforeEach(() => {
    purgeExpired = jest.fn().mockResolvedValue(0);
    job = new VerificationTokenCleanupJob({
      purgeExpired,
    } as unknown as VerificationTokenService);
  });

  describe('purgeSpentTokens', () => {
    it('delegates to purgeExpired on the service', async () => {
      await job.purgeSpentTokens();

      expect(purgeExpired).toHaveBeenCalledTimes(1);
    });

    it('resolves without throwing when the purge succeeds', async () => {
      await expect(job.purgeSpentTokens()).resolves.toBeUndefined();
    });

    it('swallows a purge failure so the scheduler survives to the next tick', async () => {
      purgeExpired.mockRejectedValue(new Error('deadlock detected'));

      await expect(job.purgeSpentTokens()).resolves.toBeUndefined();
    });
  });
});