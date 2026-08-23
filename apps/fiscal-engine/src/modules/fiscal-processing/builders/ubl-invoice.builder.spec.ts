import * as crypto from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { CufeCalculator } from './cufe.calculator';
import { UblInvoiceBuilder, BuildParams } from './ubl-invoice.builder';

function buildParams(overrides: Partial<BuildParams> = {}): BuildParams {
  return {
    documentType: 'INVOICE',
    fullNumber: 'FV-DEMO-000001',
    issueDate: '2026-08-05',
    issueTime: '10:53:10-05:00',
    issuerConfig: {
      nit: '800197268',
      verificationDigit: '4',
      businessName: 'FARMACIA DEMO SA',
      municipality: 'Bogotá D.C.',
      department: 'Cundinamarca',
      phone: '6010000000',
      email: 'facturacion@farmaciademo.co',
    },
    customerParty: null,
    sale: {
      subtotal: 1000000,
      totalTax: 190000,
      totalAmount: 1190000,
      totalDiscount: 0,
      taxAmounts: [{ code: '01', amount: 190000 }],
    },
    saleItems: [
      {
        quantity: 2,
        subtotal: 1000000,
        taxAmount: 190000,
        taxRate: 19,
        productCommercialNameSnapshot: 'Paracetamol 500mg',
        productInternalCodeSnapshot: 'P001',
        unitPrice: 500000,
      },
    ],
    softwareId: 'b8ac9b7c-3f2e-4a6d-9c1e-5f7a8b9c0d1e',
    softwareSecurityCode: 'abcdef0123456789abcdef0123456789abcdef0123456789ab',
    resolutionAuthNumber: '18764000000001',
    resolutionPeriodStart: '2026-01-01',
    resolutionPeriodEnd: '2026-12-31',
    resolutionPrefix: 'FV',
    resolutionRangeFrom: 1,
    resolutionRangeTo: 1000,
    clTec: 'CLTEC-ABC-123',
    environment: '2',
    ...overrides,
  };
}

function parseXml(xml: string): any {
  // parseTagValue: false keeps element text as strings — '01' must not
  // become the number 1 when asserting DIAN codes.
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });
  return parser.parse(xml);
}

function expectedCufe(params: BuildParams): string {
  // Same documented concatenation the builder feeds to CufeCalculator —
  // rebuilt here from the fixture values so the test verifies the whole
  // XML pipeline independently of the calculator's own tests.
  const tax = (amount: number | string) => Number(amount).toFixed(2);
  const input =
    params.fullNumber +
    params.issueDate +
    params.issueTime +
    tax(params.sale.subtotal) +
    '01' + tax(190000) +
    '04' + '0.00' +
    '03' + '0.00' +
    tax(params.sale.totalAmount) +
    params.issuerConfig.nit +
    '222222222222' +
    params.clTec +
    params.environment;
  return crypto.createHash('sha384').update(input).digest('hex');
}

describe('UblInvoiceBuilder', () => {
  let builder: UblInvoiceBuilder;

  beforeEach(() => {
    builder = new UblInvoiceBuilder(new CufeCalculator());
  });

  describe('build', () => {
    it('produces a well-formed Invoice document with the expected CUFE in UUID and QRCode', () => {
      const params = buildParams();

      const xml = builder.build(params);
      const parsed = parseXml(xml);

      const cufe = expectedCufe(params);
      expect(parsed.Invoice['cbc:UUID']['#text']).toBe(cufe);
      expect(parsed.Invoice['cbc:UUID']['@_schemeName']).toBe('CUFE-SHA384');
      expect(parsed.Invoice['ext:UBLExtensions']['ext:UBLExtension'][0]
        ['ext:ExtensionContent']['sts:DianExtensions']['sts:QRCode'])
        .toBe(`https://catalogo-vpfe.dian.gov.co/document/searchrch?documentkey=${cufe}`);
    });

    it('emits InvoiceTypeCode 01 for INVOICE and 02 for CREDIT_NOTE', () => {
      const invoice = parseXml(builder.build(buildParams()));
      expect(invoice.Invoice['cbc:InvoiceTypeCode']).toBe('01');

      const creditNote = parseXml(builder.build(buildParams({ documentType: 'CREDIT_NOTE' })));
      expect(creditNote.Invoice['cbc:InvoiceTypeCode']).toBe('02');
    });

    it('uses the documented final-consumer identity when no customer is present', () => {
      const parsed = parseXml(builder.build(buildParams()));

      const customer = parsed.Invoice['cac:AccountingCustomerParty'];
      expect(customer['cbc:AdditionalAccountID']).toBe('2');

      const party = customer['cac:Party'];
      expect(party['cac:PartyIdentification']['cbc:ID']['#text']).toBe('222222222222');
      expect(party['cac:PartyIdentification']['cbc:ID']['@_schemeName']).toBe('13');
      expect(party['cac:PartyName']['cbc:Name']).toBe('consumidor final');
      expect(party['cac:PartyTaxScheme']['cbc:CompanyID']['#text']).toBe('222222222222');
      expect(party['cac:PartyTaxScheme']['cbc:TaxLevelCode']).toBe('R-99-PN');
    });

    it('maps customer identification types to DIAN scheme codes', () => {
      const parsed = parseXml(builder.build(buildParams({
        customerParty: {
          identificationNumber: '123456789',
          identificationType: 'CC',
          fullName: 'JUAN PEREZ',
          municipality: 'Medellín',
          department: 'Antioquia',
        },
      })));

      const party = parsed.Invoice['cac:AccountingCustomerParty']['cac:Party'];
      expect(party['cac:PartyIdentification']['cbc:ID']['@_schemeID']).toBe('13');
      expect(party['cac:PartyIdentification']['cbc:ID']['#text']).toBe('123456789');
      expect(party['cac:PartyName']['cbc:Name']).toBe('JUAN PEREZ');
    });

    it('leaves an empty ds:Signature placeholder with the convention Id for XAdES signing', () => {
      const parsed = parseXml(builder.build(buildParams()));

      const extensions = parsed.Invoice['ext:UBLExtensions']['ext:UBLExtension'];
      const signature = extensions[1]['ext:ExtensionContent']['ds:Signature'];
      expect(signature['@_Id']).toBe('xmldsig-FV-DEMO-000001');
    });

    it('renders one InvoiceLine per item with quantity, totals, and seller item id', () => {
      const parsed = parseXml(builder.build(buildParams({
        saleItems: [
          {
            quantity: 2,
            subtotal: 1000000,
            taxAmount: 190000,
            taxRate: 19,
            productCommercialNameSnapshot: 'Paracetamol 500mg',
            productInternalCodeSnapshot: 'P001',
            unitPrice: 500000,
          },
          {
            quantity: 1,
            subtotal: 30000,
            taxAmount: 5700,
            taxRate: 19,
            productCommercialNameSnapshot: 'Ibuprofeno 400mg',
            productInternalCodeSnapshot: 'P002',
            unitPrice: 30000,
          },
        ],
      })));

      const lines = parsed.Invoice['cac:InvoiceLine'];
      expect(lines).toHaveLength(2);
      expect(lines[0]['cbc:ID']).toBe('1');
      expect(lines[0]['cbc:InvoicedQuantity']['#text']).toBe('2');
      expect(lines[0]['cbc:InvoicedQuantity']['@_unitCode']).toBe('EA');
      expect(lines[0]['cac:Item']['cac:SellersItemIdentification']['cbc:ID']).toBe('P001');
      expect(lines[1]['cac:Item']['cac:SellersItemIdentification']['cbc:ID']).toBe('P002');
    });

    it('emits an AllowanceCharge only when the item has a positive discount', () => {
      const withDiscount = parseXml(builder.build(buildParams({
        saleItems: [
          {
            quantity: 1,
            subtotal: 90000,
            discountAmount: 10000,
            taxAmount: 17100,
            taxRate: 19,
            productCommercialNameSnapshot: 'Paracetamol 500mg',
            productInternalCodeSnapshot: 'P001',
            unitPrice: 100000,
          },
        ],
      })));
      const line = withDiscount.Invoice['cac:InvoiceLine'];
      expect(line['cac:AllowanceCharge']['cbc:ChargeIndicator']).toBe('false');
      expect(line['cac:AllowanceCharge']['cbc:Amount']['#text']).toBe('10000.00');

      const noDiscount = parseXml(builder.build(buildParams({
        saleItems: [
          {
            quantity: 1,
            subtotal: 100000,
            taxAmount: 19000,
            taxRate: 19,
            productCommercialNameSnapshot: 'Paracetamol 500mg',
            productInternalCodeSnapshot: 'P001',
            unitPrice: 100000,
          },
        ],
      })));
      expect(noDiscount.Invoice['cac:InvoiceLine']['cac:AllowanceCharge']).toBeUndefined();
    });

    it('renders empty strings when item snapshots are absent', () => {
      const parsed = parseXml(builder.build(buildParams({
        saleItems: [
          {
            quantity: 1,
            subtotal: 100000,
            taxAmount: 19000,
            taxRate: 19,
            unitPrice: 100000,
          },
        ],
      })));

      const line = parsed.Invoice['cac:InvoiceLine'];
      expect(line['cac:Item']['cbc:Description']).toBe('');
      expect(line['cac:Item']['cac:SellersItemIdentification']['cbc:ID']).toBe('');
    });

    it('omits the contact node when the party has neither phone nor email', () => {
      const parsed = parseXml(builder.build(buildParams({
        issuerConfig: {
          nit: '800197268',
          verificationDigit: '4',
          businessName: 'FARMACIA DEMO SA',
          municipality: 'Bogotá D.C.',
          department: 'Cundinamarca',
        },
        customerParty: {
          identificationNumber: '123456789',
          identificationType: 'CC',
          fullName: 'JUAN PEREZ',
        },
      })));

      const supplier = parsed.Invoice['cac:AccountingSupplierParty']['cac:Party'];
      expect(supplier['cac:Contact']).toBeUndefined();
      const customer = parsed.Invoice['cac:AccountingCustomerParty']['cac:Party'];
      expect(customer['cac:Contact']).toBeUndefined();
    });

    it('emits the issuer taxRegime as PartyTaxScheme/cbc:TaxLevelCode', () => {
      const parsed = parseXml(builder.build(buildParams({
        issuerConfig: {
          ...buildParams().issuerConfig,
          taxRegime: 'R-99-PJ',
        },
      })));

      const supplier = parsed.Invoice['cac:AccountingSupplierParty']['cac:Party'];
      expect(supplier['cac:PartyTaxScheme']['cbc:TaxLevelCode']).toBe('R-99-PJ');
    });

    it('omits PartyTaxScheme/cbc:TaxLevelCode when the issuer has no taxRegime', () => {
      const parsed = parseXml(builder.build(buildParams()));

      const supplier = parsed.Invoice['cac:AccountingSupplierParty']['cac:Party'];
      expect(supplier['cac:PartyTaxScheme']['cbc:TaxLevelCode']).toBeUndefined();
    });

    it('emits the DANE municipality code as the supplier Address cbc:ID', () => {
      const parsed = parseXml(builder.build(buildParams({
        issuerConfig: {
          ...buildParams().issuerConfig,
          municipioCode: '11001',
        },
      })));

      const address = parsed.Invoice['cac:AccountingSupplierParty']['cac:Party']
        ['cac:PhysicalLocation']['cac:Address'];
      expect(address['cbc:ID']).toBe('11001');
      expect(address['cbc:CityName']).toBe('Bogotá D.C.');
    });

    it('falls back to the municipality name in Address cbc:ID when no code is configured', () => {
      const parsed = parseXml(builder.build(buildParams()));

      const address = parsed.Invoice['cac:AccountingSupplierParty']['cac:Party']
        ['cac:PhysicalLocation']['cac:Address'];
      expect(address['cbc:ID']).toBe('Bogotá D.C.');
      expect(address['cbc:CityName']).toBe('Bogotá D.C.');
    });

    it('emits the software id in sts:softwareID', () => {
      const parsed = parseXml(builder.build(buildParams()));

      const softwareId = parsed.Invoice['ext:UBLExtensions']['ext:UBLExtension'][0]
        ['ext:ExtensionContent']['sts:DianExtensions']['sts:SoftwareProvider']
        ['sts:softwareID'];
      expect(softwareId['#text']).toBe('b8ac9b7c-3f2e-4a6d-9c1e-5f7a8b9c0d1e');
      expect(softwareId['@_schemeAgencyID']).toBe('195');
    });

    it('renders an empty sts:softwareID when no software id is provided', () => {
      const parsed = parseXml(builder.build(buildParams({ softwareId: '' })));

      const softwareId = parsed.Invoice['ext:UBLExtensions']['ext:UBLExtension'][0]
        ['ext:ExtensionContent']['sts:DianExtensions']['sts:SoftwareProvider']
        ['sts:softwareID'];
      expect(softwareId).toBeDefined();
      expect(softwareId['@_schemeAgencyID']).toBe('195');
      expect(softwareId['#text']).toBeUndefined();
    });

    it('accepts Decimal-like values through toDec conversion', () => {
      const decimalLike = (value: number) => ({ toNumber: () => value });
      const parsed = parseXml(builder.build(buildParams({
        sale: {
          subtotal: decimalLike(1000000),
          totalTax: decimalLike(190000),
          totalAmount: decimalLike(1190000),
          totalDiscount: decimalLike(0),
          taxAmounts: [{ code: '01', amount: decimalLike(190000) }],
        },
        saleItems: [
          {
            quantity: 2,
            subtotal: decimalLike(1000000),
            taxAmount: decimalLike(190000),
            taxRate: decimalLike(19),
            productCommercialNameSnapshot: 'Paracetamol 500mg',
            productInternalCodeSnapshot: 'P001',
            unitPrice: decimalLike(500000),
          },
        ],
      })));

      expect(parsed.Invoice['cac:LegalMonetaryTotal']['cbc:PayableAmount']['#text']).toBe('1190000.00');
      expect(parsed.Invoice['cac:TaxTotal']['cbc:TaxAmount']['#text']).toBe('190000.00');
    });
  });
});
