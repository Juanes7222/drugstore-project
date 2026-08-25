import { SoapFiscalTransmissionAdapter } from './soap-fiscal-transmission.adapter';
import {
  DIAN_ENDPOINTS,
  SOAP_ACTION_SEND_BILL_SYNC,
  SOAP_ACTION_GET_STATUS,
  SOAP_ACTION_GET_NUMBERING_RANGE,
} from '../signing/dian-constants';
import { InvalidDianEnvironmentException } from '../exceptions/invalid-dian-environment.exception';

const PRODUCTION_URL = DIAN_ENDPOINTS['1'];
const HABILITACION_URL = DIAN_ENDPOINTS['2'];
const CERT = Buffer.from('fake-p12-bytes');
const PASSWORD = 'test-password';

type Collaborators = {
  certificateLoader: { loadFromBuffer: jest.Mock };
  xadesSigner: { sign: jest.Mock };
  soapSigner: { sign: jest.Mock };
  envelopeBuilder: {
    buildSendBillSync: jest.Mock;
    buildGetNumberingRangeByTaxId: jest.Mock;
    buildGetStatus: jest.Mock;
  };
  httpClient: { sendAndGetResult: jest.Mock };
};

function createCollaborators(): Collaborators {
  return {
    certificateLoader: {
      loadFromBuffer: jest.fn().mockResolvedValue({ key: 'key', cert: 'cert' }),
    },
    xadesSigner: { sign: jest.fn().mockReturnValue('<SignedInvoice/>') },
    soapSigner: { sign: jest.fn().mockReturnValue('<SignedSoap/>') },
    envelopeBuilder: {
      buildSendBillSync: jest.fn().mockReturnValue('<SendBillSyncEnvelope/>'),
      buildGetNumberingRangeByTaxId: jest
        .fn()
        .mockReturnValue('<GetNumberingRangeEnvelope/>'),
      buildGetStatus: jest.fn().mockReturnValue('<GetStatusEnvelope/>'),
    },
    httpClient: { sendAndGetResult: jest.fn() },
  };
}

function createAdapter(collaborators: Collaborators): SoapFiscalTransmissionAdapter {
  const adapter = new SoapFiscalTransmissionAdapter();
  // Collaborators are constructed inline as private fields; replace them on
  // the instance so each test observes signing and transport interactions.
  Object.assign(adapter as unknown as Record<string, unknown>, collaborators);
  return adapter;
}

describe('SoapFiscalTransmissionAdapter endpoint resolution', () => {
  it('sends to the producción endpoint when the environment is "1"', async () => {
    const collaborators = createCollaborators();
    collaborators.httpClient.sendAndGetResult.mockResolvedValue({
      OperationCode: '100',
      ResponseList: [],
    });
    const adapter = createAdapter(collaborators);

    await adapter.fetchNumberingRanges(CERT, PASSWORD, '1', '900123456', '900123456');

    expect(collaborators.soapSigner.sign).toHaveBeenCalledWith(
      '<GetNumberingRangeEnvelope/>',
      expect.anything(),
      SOAP_ACTION_GET_NUMBERING_RANGE,
      PRODUCTION_URL,
    );
    expect(collaborators.httpClient.sendAndGetResult).toHaveBeenCalledWith(
      '<SignedSoap/>',
      PRODUCTION_URL,
      SOAP_ACTION_GET_NUMBERING_RANGE,
      'GetNumberingRangeResponse',
    );
  });

  it('sends to the habilitación endpoint when the environment is "2"', async () => {
    const collaborators = createCollaborators();
    collaborators.httpClient.sendAndGetResult.mockResolvedValue({
      IsValid: true,
      StatusCode: '00',
      StatusDescription: 'Validated',
    });
    const adapter = createAdapter(collaborators);

    await adapter.checkStatus('track-1', CERT, PASSWORD, '2');

    expect(collaborators.soapSigner.sign).toHaveBeenCalledWith(
      '<GetStatusEnvelope/>',
      expect.anything(),
      SOAP_ACTION_GET_STATUS,
      HABILITACION_URL,
    );
    expect(collaborators.httpClient.sendAndGetResult).toHaveBeenCalledWith(
      '<SignedSoap/>',
      HABILITACION_URL,
      SOAP_ACTION_GET_STATUS,
      'GetStatusResponse',
    );
  });

  it('rejects an unknown environment before any signing work in signAndSend', async () => {
    const collaborators = createCollaborators();
    const adapter = createAdapter(collaborators);

    await expect(
      adapter.signAndSend('<Invoice/>', 'file.xml', CERT, PASSWORD, 'PRODUCCION'),
    ).rejects.toThrow(InvalidDianEnvironmentException);

    // Fail-fast ordering: the invalid environment must abort before any
    // signing work (XAdES and WS-Security), the SOAP envelope build, and
    // any network traffic.
    expect(collaborators.xadesSigner.sign).not.toHaveBeenCalled();
    expect(collaborators.soapSigner.sign).not.toHaveBeenCalled();
    expect(collaborators.envelopeBuilder.buildSendBillSync).not.toHaveBeenCalled();
    expect(collaborators.httpClient.sendAndGetResult).not.toHaveBeenCalled();
  });

  it('rejects an unknown environment in fetchNumberingRanges without contacting DIAN', async () => {
    const collaborators = createCollaborators();
    const adapter = createAdapter(collaborators);

    await expect(
      adapter.fetchNumberingRanges(CERT, PASSWORD, '3', '900123456', '900123456'),
    ).rejects.toThrow(InvalidDianEnvironmentException);
    expect(collaborators.httpClient.sendAndGetResult).not.toHaveBeenCalled();
  });

  it('rejects an unknown environment in checkStatus without contacting DIAN', async () => {
    const collaborators = createCollaborators();
    const adapter = createAdapter(collaborators);

    await expect(
      adapter.checkStatus('track-1', CERT, PASSWORD, ''),
    ).rejects.toThrow(InvalidDianEnvironmentException);
    expect(collaborators.httpClient.sendAndGetResult).not.toHaveBeenCalled();
  });

  it('carries the offending value and both valid literals in the error message', async () => {
    const collaborators = createCollaborators();
    const adapter = createAdapter(collaborators);

    await expect(
      adapter.signAndSend('<Invoice/>', 'file.xml', CERT, PASSWORD, 'TEST'),
    ).rejects.toThrow(/"TEST".*"1".*"2"/s);
  });
});

// Regression: DIAN_ENDPOINTS used to be a plain object literal, so these
// Object.prototype member names resolved to inherited values instead of
// undefined and slipped past the invalid-environment guard.
const PROTOTYPE_KEY_ENVIRONMENTS = ['toString', 'valueOf', 'constructor', '__proto__'];

describe('SoapFiscalTransmissionAdapter prototype-key environments', () => {
  it.each(PROTOTYPE_KEY_ENVIRONMENTS)(
    'rejects environment %s in signAndSend before any collaborator runs',
    async (environment) => {
      const collaborators = createCollaborators();
      const adapter = createAdapter(collaborators);

      await expect(
        adapter.signAndSend('<Invoice/>', 'file.xml', CERT, PASSWORD, environment),
      ).rejects.toThrow(InvalidDianEnvironmentException);

      expect(collaborators.xadesSigner.sign).not.toHaveBeenCalled();
      expect(collaborators.soapSigner.sign).not.toHaveBeenCalled();
      expect(collaborators.envelopeBuilder.buildSendBillSync).not.toHaveBeenCalled();
      expect(collaborators.httpClient.sendAndGetResult).not.toHaveBeenCalled();
    },
  );

  it('resolves endpoints from a null-prototype dictionary', () => {
    expect(Object.getPrototypeOf(DIAN_ENDPOINTS)).toBeNull();
  });
});

describe('SoapFiscalTransmissionAdapter signAndSend', () => {
  it('XAdES-signs, base64-encodes, WS-Sec-signs, transmits, and parses the result', async () => {
    const collaborators = createCollaborators();
    collaborators.httpClient.sendAndGetResult.mockResolvedValue({
      IsValid: 'true',
      XmlDocumentKey: 'KEY-123',
      XmlDocument: '<SignedInvoice/>',
      StatusDescription: 'Processed OK',
      StatusCode: '00',
    });
    const adapter = createAdapter(collaborators);

    const result = await adapter.signAndSend(
      '<Invoice/>',
      'FV-1.xml',
      CERT,
      PASSWORD,
      '2',
    );

    expect(collaborators.certificateLoader.loadFromBuffer).toHaveBeenCalledWith(CERT, PASSWORD);
    expect(collaborators.xadesSigner.sign).toHaveBeenCalledWith('<Invoice/>', {
      key: 'key',
      cert: 'cert',
    });
    expect(collaborators.envelopeBuilder.buildSendBillSync).toHaveBeenCalledWith(
      'FV-1.xml',
      Buffer.from('<SignedInvoice/>').toString('base64'),
    );
    expect(collaborators.soapSigner.sign).toHaveBeenCalledWith(
      '<SendBillSyncEnvelope/>',
      expect.anything(),
      SOAP_ACTION_SEND_BILL_SYNC,
      HABILITACION_URL,
    );
    expect(result).toEqual({
      isValid: true,
      xmlDocumentKey: 'KEY-123',
      signedXml: '<SignedInvoice/>',
      statusMessage: 'Processed OK',
      statusCode: '00',
    });
  });
});
