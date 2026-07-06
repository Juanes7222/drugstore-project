import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../../common/exceptions/domain.exception';

/**
 * Thrown when the transmission to DIAN fails before receiving a response
 * (network error, certificate read failure, malformed request, etc.).
 * The processor uses this to transition the document to SIGNATURE_ERROR
 * or to leave it in IN_TRANSMISSION depending on when the failure occurred.
 */
export class FiscalTransmissionFailedException extends DomainException {
  constructor(documentId: string, cause: string) {
    super(
      'FISCAL_TRANSMISSION_FAILED',
      `Fiscal document "${documentId}" transmission failed: ${cause}`,
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
