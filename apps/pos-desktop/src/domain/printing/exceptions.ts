/**
 * Domain exceptions for the printing subsystem.
 *
 * Every exception extends DomainError with a stable errorCode for
 * programmatic discrimination in catch blocks.
 */

import { DomainError } from '../../common/domain-error';

/**
 * Thrown when attempting to assign a job type to multiple primary printers.
 */
export class JobTypeAlreadyAssignedException extends DomainError {
  constructor(jobType: string, existingPrinterName: string) {
    super(
      'JOB_TYPE_ALREADY_ASSIGNED',
      `El tipo de trabajo "${jobType}" ya está asignado a "${existingPrinterName}". Solo puede tener una impresora principal por tipo de trabajo.`,
    );
  }
}

/**
 * Thrown when trying to use a printer that is not configured.
 */
export class PrinterNotConfiguredException extends DomainError {
  constructor(printerId: string) {
    super(
      'PRINTER_NOT_CONFIGURED',
      `No se encontró la impresora con ID "${printerId}".`,
    );
  }
}

/**
 * Thrown when no printer is configured for a specific job type.
 */
export class NoPrinterForJobTypeException extends DomainError {
  constructor(jobType: string) {
    super(
      'NO_PRINTER_FOR_JOB_TYPE',
      `No hay impresora configurada para trabajos de tipo "${jobType}". El trabajo se encolará.`,
    );
  }
}

/**
 * Thrown when a print job is not found.
 */
export class PrintJobNotFoundException extends DomainError {
  constructor(jobId: string) {
    super(
      'PRINT_JOB_NOT_FOUND',
      `No se encontró el trabajo de impresión con ID "${jobId}".`,
    );
  }
}

/**
 * Thrown when a printer's fallback chain forms a cycle.
 */
export class FallbackCycleException extends DomainError {
  constructor(printerId: string) {
    super(
      'FALLBACK_CYCLE_DETECTED',
      `La cadena de respaldo para la impresora "${printerId}" forma un ciclo. Revise la configuración.`,
    );
  }
}

/**
 * Thrown when a print payload file is missing or unreadable.
 */
export class PrintPayloadNotFoundException extends DomainError {
  constructor(path: string) {
    super(
      'PRINT_PAYLOAD_NOT_FOUND',
      `No se encontró el archivo de impresión en "${path}".`,
    );
  }
}

/**
 * Thrown when attempting to assign an unknown job type to a printer.
 */
export class UnknownJobTypeException extends DomainError {
  constructor(jobType: string) {
    super(
      'UNKNOWN_JOB_TYPE',
      `Tipo de trabajo de impresión desconocido: "${jobType}".`,
    );
  }
}

/**
 * Thrown when the export/import configuration has incompatible data.
 */
export class ConfigImportException extends DomainError {
  constructor(detail: string) {
    super(
      'CONFIG_IMPORT_ERROR',
      `Error al importar la configuración de impresoras: ${detail}`,
    );
  }
}
