/**
 * Domain exceptions for the local invoice adjustment layer.
 */

import { DomainError } from '../../common/domain-error';
import type { AdjustmentType } from './local-adjustment.types';

/**
 * Thrown when a non-manager/non-admin attempts to invoke an adjustment method.
 */
export class AdjustmentAuthorizationException extends DomainError {
  constructor() {
    super(
      'ADJUSTMENT_AUTHORIZATION',
      'Only managers and administrators can apply invoice adjustments.',
    );
  }
}

/**
 * Thrown when attempting to adjust an invoice that does not exist.
 */
export class AdjustmentInvoiceNotFoundException extends DomainError {
  constructor(invoiceId: string) {
    super(
      'ADJUSTMENT_INVOICE_NOT_FOUND',
      `Invoice ${invoiceId} not found; cannot apply adjustment.`,
    );
  }
}

/**
 * Thrown when the adjustment type is not allowed for the invoice's current status.
 */
export class AdjustmentNotAllowedForStatusException extends DomainError {
  constructor(invoiceId: string, status: string, adjustmentType: AdjustmentType) {
    super(
      'ADJUSTMENT_NOT_ALLOWED_FOR_STATUS',
      `Adjustment type ${adjustmentType} is not allowed for invoice ${invoiceId} ` +
        `with status ${status}.`,
    );
  }
}

/**
 * Thrown when the reason field is too short (< 10 characters).
 */
export class AdjustmentReasonTooShortException extends DomainError {
  constructor() {
    super(
      'ADJUSTMENT_REASON_TOO_SHORT',
      'The reason for an adjustment must be at least 10 characters long.',
    );
  }
}

/**
 * Thrown when attempting to reverse an adjustment that does not exist.
 */
export class AdjustmentNotFoundException extends DomainError {
  constructor(adjustmentId: string) {
    super(
      'ADJUSTMENT_NOT_FOUND',
      `Adjustment ${adjustmentId} not found.`,
    );
  }
}

/**
 * Thrown when attempting to reverse an adjustment that has already been reversed.
 */
export class AdjustmentAlreadyReversedException extends DomainError {
  constructor(adjustmentId: string) {
    super(
      'ADJUSTMENT_ALREADY_REVERSED',
      `Adjustment ${adjustmentId} has already been reversed.`,
    );
  }
}

/**
 * Thrown when the adjustment history version has changed since the caller read it
 * (optimistic concurrency).
 */
export class AdjustmentConflictException extends DomainError {
  constructor(invoiceId: string) {
    super(
      'ADJUSTMENT_CONFLICT',
      `Concurrent modification detected for invoice ${invoiceId}. ` +
        'Please refresh and retry.',
    );
  }
}
