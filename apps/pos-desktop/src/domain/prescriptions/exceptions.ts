/**
 * Prescription-specific domain errors for the POS desktop app.
 */
import { DomainError } from '../../common/domain-error';

/**
 * Thrown when a prescription references a sale item that does not exist.
 */
export class PrescriptionSaleItemNotFoundException extends DomainError {
  constructor(saleItemId: string) {
    super(
      'PRESCRIPTION_SALE_ITEM_NOT_FOUND',
      `SaleItem ${saleItemId} not found for prescription attachment.`,
    );
  }
}

/**
 * Thrown when a prescription is not found.
 */
export class PrescriptionNotFoundException extends DomainError {
  constructor(prescriptionId: string) {
    super(
      'PRESCRIPTION_NOT_FOUND',
      `Prescription with ID ${prescriptionId} not found.`,
    );
  }
}

/**
 * Thrown when a controlled substance prescription is created without
 * mandatory fields (book entry, page number).
 */
export class ControlledSubstanceFieldsRequiredException extends DomainError {
  constructor(missingField: string) {
    super(
      'CONTROLLED_SUBSTANCE_FIELDS_REQUIRED',
      `Controlled substance prescriptions require "${missingField}".`,
    );
  }
}

/**
 * Thrown when the referenced sale item already has a prescription attached.
 */
export class PrescriptionAlreadyExistsException extends DomainError {
  constructor(saleItemId: string) {
    super(
      'PRESCRIPTION_ALREADY_EXISTS',
      `SaleItem ${saleItemId} already has a prescription attached.`,
    );
  }
}
