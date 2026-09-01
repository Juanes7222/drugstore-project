/**
 * Inventory-count domain errors — offline reconteo completo.
 */
import { DomainError } from '../../common/domain-error';

export class InventoryCountNotFoundException extends DomainError {
  constructor(sessionId: string) {
    super('INVENTORY_COUNT_NOT_FOUND', `Inventory count session ${sessionId} not found.`);
  }
}

export class InventoryCountStateException extends DomainError {
  constructor(sessionId: string, current: string, expected: string) {
    super(
      'INVENTORY_COUNT_STATE_INVALID',
      `Count ${sessionId} is in state "${current}", expected "${expected}".`,
    );
  }
}

export class InventoryCountLineNotFoundException extends DomainError {
  constructor(lineId: string) {
    super('INVENTORY_COUNT_LINE_NOT_FOUND', `Count line ${lineId} not found.`);
  }
}

export class InventoryCountAlreadyExistsException extends DomainError {
  constructor() {
    super('INVENTORY_COUNT_ALREADY_ACTIVE', 'An active inventory count is already in progress. Close or cancel it before creating a new one.');
  }
}

export class InventoryCountNoLinesException extends DomainError {
  constructor() {
    super('INVENTORY_COUNT_NO_LINES', 'No inventory lines to count. Snapshot is empty — check scope filters.');
  }
}

export class InventoryCountNotReadyToCloseException extends DomainError {
  constructor(reason: string) {
    super('INVENTORY_COUNT_NOT_READY_TO_CLOSE', reason);
  }
}
