import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/**
 * Thrown when a requested preset code (SIMPLE, BALANCED, STRICT, or a named
 * preset) does not exist.
 */
export class PresetNotFoundException extends DomainException {
  constructor(presetCode: string) {
    super(
      'PRESET_NOT_FOUND',
      `Preset "${presetCode}" not found. Available built-in presets: SIMPLE, BALANCED, STRICT.`,
      HttpStatus.NOT_FOUND,
    );
  }
}
