import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

const ARGON2_ALGORITHM = 'argon2id';

@Injectable()
export class PasswordHasherService {
  async hash(password: string): Promise<{ hash: string; algorithm: string }> {
    const hash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    return {
      hash,
      algorithm: ARGON2_ALGORITHM,
    };
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
}
