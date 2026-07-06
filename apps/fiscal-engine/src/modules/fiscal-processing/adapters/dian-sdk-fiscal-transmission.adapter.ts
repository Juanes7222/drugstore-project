import { Injectable, Logger } from '@nestjs/common';
import { DianClient, SendBillSyncCommand, GetStatusCommand, GetNumberingRangeCommand } from 'dian-sdk-node';
import { FiscalTransmissionPort } from '../ports/fiscal-transmission.port';
import { SendResult, StatusResult } from '../ports/transmission-results.type';

/**
 * Adapter that wraps dian-sdk-node's DianClient behind the
 * FiscalTransmissionPort interface.
 *
 * If this library ever proves inadequate against DIAN's actual habilitación
 * test set, replacing it means writing a new adapter behind the same port,
 * not restructuring this module — this is the whole reason the port exists.
 */
@Injectable()
export class DianSdkFiscalTransmissionAdapter implements FiscalTransmissionPort {
  private readonly logger = new Logger(DianSdkFiscalTransmissionAdapter.name);

  async signAndSend(
    unsignedXml: string,
    fileName: string,
    certificate: Buffer,
    certPassword: string,
    environment: string,
  ): Promise<SendResult> {
    const env = environment === '1' ? 1 : 2;
    const client = new DianClient({ environment: env });

    await client.initialize({
      certificate,
      passwordPsswrd: certPassword,
    });

    this.logger.debug('DianClient initialized, executing SendBillSyncCommand');

    const command = new SendBillSyncCommand();
    const rawResult: any = await client.execute(command, {
      fileName,
      unsignedUblXml: unsignedXml,
    });

    return {
      isValid: rawResult?.IsValid === true,
      xmlDocumentKey: rawResult?.XmlDocumentKey ?? null,
      signedXml: rawResult?.XmlDocument ?? null,
      statusMessage: rawResult?.StatusDescription ?? rawResult?.StatusMessage ?? null,
      statusCode: rawResult?.StatusCode != null ? String(rawResult.StatusCode) : null,
    };
  }

  async getNumberingRange(
    certificate: Buffer,
    certPassword: string,
    environment: string,
    resolutionNumber: string,
  ): Promise<{ clTec: string }> {
    const env = environment === '1' ? 1 : 2;
    const client = new DianClient({ environment: env });

    await client.initialize({
      certificate,
      passwordPsswrd: certPassword,
    });

    this.logger.debug(
      `DianClient initialized, executing GetNumberingRangeCommand for resolution ${resolutionNumber}`,
    );

    const command = new GetNumberingRangeCommand();
    const rawResult: any = await client.execute(command, {
      resolutionNumber,
    });

    const clTec: string = rawResult?.ClTec ?? '';

    if (!clTec) {
      this.logger.warn(
        `GetNumberingRange returned empty ClTec for resolution ${resolutionNumber} — CUFE will be incorrect`,
      );
    }

    return { clTec };
  }
}

  async checkStatus(
    trackId: string,
    certificate: Buffer,
    certPassword: string,
    environment: string,
  ): Promise<StatusResult> {
    const env = environment === '1' ? 1 : 2;
    const client = new DianClient({ environment: env });

    await client.initialize({
      certificate,
      passwordPsswrd: certPassword,
    });

    this.logger.debug(`DianClient initialized, executing GetStatusCommand for trackId=${trackId}`);

    const command = new GetStatusCommand();
    const rawResult: any = await client.execute(command, {
      trackId,
    });

    return {
      isValid: rawResult?.IsValid === true,
      statusCode: rawResult?.StatusCode != null ? String(rawResult.StatusCode) : null,
      statusDescription: rawResult?.StatusDescription ?? rawResult?.StatusMessage ?? null,
    };
  }
}
