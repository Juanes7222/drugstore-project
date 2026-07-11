/**
 * Cross-station printer configuration export/import.
 *
 * Use case: the manager configures Station 1 fully, exports the config,
 * then walks to Station 2 and imports it. The setup time for the second
 * station drops from 3 minutes to 30 seconds.
 *
 * The export serializes everything except `systemName` (which is
 * workstation-specific) and `id` (which is regenerated on import).
 * The import runs discovery on the target workstation and maps imported
 * printers to discovered ones by model type and connection.
 */

import type { PrinterConfigService } from './printer-config.service';
import type {
  ExportedPrinterConfig,
  ExportedPrinterEntry,
  ImportReport,
  ImportUnmatchedEntry,
  DiscoveredPrinter,
} from './printing-types';
import { ConfigImportException } from './exceptions';

export const CONFIG_EXPORT_VERSION = 1;

export interface ConfigExportService {
  /**
   * Export the current printer configuration to a JSON string.
   * Excludes `systemName` and `id` (workstation-specific).
   */
  exportConfig(): Promise<string>;

  /**
   * Import a printer configuration from a JSON string.
   * Runs discovery to match imported printers to this workstation's printers.
   */
  importConfig(json: string, options: {
    overwrite: boolean;
  }): Promise<ImportReport>;

  /**
   * Import a printer configuration from an already-parsed ExportedPrinterConfig.
   */
  importFromData(
    data: ExportedPrinterConfig,
    options: { overwrite: boolean },
  ): Promise<ImportReport>;
}

export const createConfigExportService = (
  printerConfigService: PrinterConfigService,
  /**
   * External discovery function. Called during import to find printers
   * on the current workstation.
   */
  discoverPrinters: () => Promise<DiscoveredPrinter[]>,
): ConfigExportService => {
  return new ConfigExportServiceImpl(
    printerConfigService,
    discoverPrinters,
  );
};

class ConfigExportServiceImpl implements ConfigExportService {
  constructor(
    private readonly printerConfigService: PrinterConfigService,
    private readonly discoverPrinters: () => Promise<DiscoveredPrinter[]>,
  ) {}

  async exportConfig(): Promise<string> {
    const printers = await this.printerConfigService.listAll();

    const exported: ExportedPrinterConfig = {
      version: CONFIG_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      printers: printers.map((p) => {
        // Find the index of the fallback printer
        let fallbackPrinterIndex: number | null = null;
        if (p.fallbackPrinterId) {
          const idx = printers.findIndex(
            (other) => other.id === p.fallbackPrinterId,
          );
          if (idx >= 0) {
            fallbackPrinterIndex = idx;
          }
        }

        return {
          friendlyName: p.friendlyName,
          printerType: p.printerType,
          connection: p.connection,
          paperSize: p.paperSize,
          supportsColor: p.supportsColor,
          assignedJobs: p.assignedJobs as string[],
          serverFallbackEnabled: p.serverFallbackEnabled,
          fallbackPrinterIndex,
        };
      }),
    };

    return JSON.stringify(exported, null, 2);
  }

  async importConfig(
    json: string,
    options: { overwrite: boolean },
  ): Promise<ImportReport> {
    let data: ExportedPrinterConfig;
    try {
      data = JSON.parse(json) as ExportedPrinterConfig;
    } catch {
      throw new ConfigImportException(
        'El archivo JSON no es válido.',
      );
    }

    // Validate version
    if (data.version !== CONFIG_EXPORT_VERSION) {
      throw new ConfigImportException(
        `Versión de configuración no soportada: ${data.version}. ` +
          `Esperada: ${CONFIG_EXPORT_VERSION}.`,
      );
    }

    return this.importFromData(data, options);
  }

  async importFromData(
    data: ExportedPrinterConfig,
    options: { overwrite: boolean },
  ): Promise<ImportReport> {
    // Step 1: Discover printers on this workstation
    const discovered = await this.discoverPrinters();

    const matched: Array<{
      importedEntry: ExportedPrinterEntry;
      matchedPrinter: DiscoveredPrinter;
      fallbackIndex: number | null;
    }> = [];

    const unmatched: ImportUnmatchedEntry[] = [];
    const warnings: string[] = [];

    // Step 2: Match imported entries to discovered printers
    for (let i = 0; i < data.printers.length; i++) {
      const entry = data.printers[i];
      const match = this.matchPrinter(entry, discovered);

      if (match) {
        matched.push({
          importedEntry: entry,
          matchedPrinter: match,
          fallbackIndex: entry.fallbackPrinterIndex ?? null,
        });

        // Check for paper size mismatches
        const discoveredType = match.printerType;
        if (
          entry.printerType !== discoveredType &&
          discoveredType !== 'UNKNOWN'
        ) {
          warnings.push(
            `"${entry.friendlyName}": La config importada dice ` +
              `${entry.printerType} pero la impresora descubierta es ` +
              `${discoveredType}. Se usará el tipo detectado.`,
          );
        }
      } else {
        unmatched.push({
          friendlyName: entry.friendlyName,
          reason: `No se encontró una impresora "${entry.printerType}" ` +
            `con conexión "${entry.connection}" en esta estación.`,
        });
      }
    }

    // Step 3: Apply the matched printers
    const createdPrinterIds: string[] = [];

    if (options.overwrite) {
      // If overwrite, delete all existing printers first
      const existing = await this.printerConfigService.listAll();
      for (const p of existing) {
        await this.printerConfigService.delete(p.id);
      }
    }

    // First pass: create all printers (without fallback references)
    for (const match of matched) {
      const discoveredPrinter = match.matchedPrinter;
      const entry = match.importedEntry;

      const printer = await this.printerConfigService.create({
        friendlyName: entry.friendlyName,
        systemName: discoveredPrinter.systemName,
        printerType: entry.printerType as any,
        connection: discoveredPrinter.connection as any,
        paperSize: entry.paperSize,
        supportsColor: entry.supportsColor,
        assignedJobs: entry.assignedJobs,
        serverFallbackEnabled: entry.serverFallbackEnabled,
      });

      createdPrinterIds.push(printer.id);
    }

    // Second pass: set up fallback chains (now that all printers exist)
    for (let i = 0; i < matched.length; i++) {
      const match = matched[i];
      const printerId = createdPrinterIds[i];

      if (match.fallbackIndex !== null && match.fallbackIndex >= 0 && match.fallbackIndex < createdPrinterIds.length) {
        await this.printerConfigService.setFallbackChain(
          printerId,
          createdPrinterIds[match.fallbackIndex],
          match.importedEntry.serverFallbackEnabled,
        );
      } else {
        await this.printerConfigService.setFallbackChain(
          printerId,
          null,
          match.importedEntry.serverFallbackEnabled,
        );
      }
    }

    return {
      totalInConfig: data.printers.length,
      matched: matched.length,
      unmatched,
      warnings,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Try to match an imported printer entry to a discovered printer.
   * Matching criteria: same printer type (or compatible), same connection type.
   */
  private matchPrinter(
    entry: ExportedPrinterEntry,
    discovered: DiscoveredPrinter[],
  ): DiscoveredPrinter | null {
    // First priority: exact match on both type and connection
    const exactMatch = discovered.find(
      (d) =>
        d.printerType === entry.printerType &&
        d.connection === entry.connection,
    );
    if (exactMatch) return exactMatch;

    // Second priority: same type, any connection
    const typeMatch = discovered.find(
      (d) => d.printerType === entry.printerType,
    );
    if (typeMatch) return typeMatch;

    // Third priority: same connection, any compatible type
    // THERMAL_RECEIPT can map to UNKNOWN, LASER can map to MULTIFUNCTION
    const connectionMatch = discovered.find(
      (d) =>
        d.connection === entry.connection &&
        (d.printerType === entry.printerType ||
          d.printerType === 'UNKNOWN' ||
          entry.printerType === 'UNKNOWN'),
    );
    if (connectionMatch) return connectionMatch;

    return null;
  }
}
