import { create } from 'xmlbuilder2';
import { CufeCalculator } from './cufe.calculator';

// ── UBL standard namespaces ──
const UBL_NS = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
const CAC_NS = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
const CBC_NS = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';
const EXT_NS = 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2';

// ── DIAN extension namespaces ──
const STS_NS = 'http://www.dian.gov.co/contratos/facturaelectronica/v1';
const DS_NS = 'http://www.w3.org/2000/09/xmldsig#';

// ── DIAN technical constants ──
const AGENCY_ID = '195';
const DIAN_AGENCY_NAME = 'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)';
const COUNTRY_LIST_AGENCY_ID = '6';
const COUNTRY_LIST_AGENCY_NAME = 'United Nations Economic Commission for Europe';
const COUNTRY_LIST_SCHEME_URI =
  'urn:oasis:names:specification:ubl:codelist:gc:CountryIdentificationCode-2.1';
const DIAN_NIT = '800197268';
const DIAN_VERIFICATION_DIGIT = '4';
const QR_CODE_URL_TEMPLATE =
  'https://catalogo-vpfe.dian.gov.co/document/searchrch?documentkey=';

// ── Final-consumer identity constants (DIAN annex v1.9, numeral 6.1) ──
const FINAL_CONSUMER_ADDITIONAL_ACCOUNT_ID = '2';
const FINAL_CONSUMER_ID = '222222222222';
const FINAL_CONSUMER_SCHEME_NAME = '13';
const FINAL_CONSUMER_REGISTRATION_NAME = 'consumidor final';
const FINAL_CONSUMER_TAX_LEVEL_CODE = 'R-99-PN';

// ── Invoice-level constants ──
const CURRENCY = 'COP';
const UNIT_CODE = 'EA';
const TAX_SCHEME_IVA = '01';
const TAX_CATEGORY_IVA = '01';
const IVA_PERCENT_DEFAULT = '19.00';
const DOC_TYPE_INVOICE = '01';
const DOC_TYPE_CREDIT_NOTE = '02';
const CUSTOMIZATION_ID = '10';
const PROFILE_ID = 'DIAN 2.1: Invoice';
const PROFILE_EXECUTION_ID = '1';
const UBL_VERSION = 'UBL 2.1';
const CUFE_SCHEME_NAME = 'CUFE-SHA384';

const IDENTIFICATION_TYPE_MAP: Record<string, string> = {
  CC: '13',
  CE: '31',
  NIT: '31',
  TI: '41',
  PASSPORT: '42',
};

export interface IssuerConfig {
  nit: string;
  verificationDigit: string;
  businessName: string;
  municipality: string;
  department: string;
  phone?: string;
  email?: string;
}

export interface CustomerPartyData {
  identificationNumber?: string;
  identificationType?: string;
  fullName?: string;
  municipality?: string;
  department?: string;
  email?: string;
  phone?: string;
}

export interface TaxBreakdown {
  code: string;
  amount: any;
}

export interface SaleTotals {
  subtotal: any;
  totalTax: any;
  totalAmount: any;
  totalDiscount: any;
  taxAmounts?: TaxBreakdown[];
}

export interface SaleItem {
  quantity: number;
  subtotal: any;
  discountAmount?: any;
  taxAmount: any;
  taxRate: any;
  productCommercialNameSnapshot?: string;
  productGenericNameSnapshot?: string;
  productInternalCodeSnapshot?: string;
  unitPrice: any;
}

export interface BuildParams {
  documentType: string;
  fullNumber: string;
  issueDate: string;
  issueTime: string;
  issuerConfig: IssuerConfig;
  customerParty: CustomerPartyData | null;
  sale: SaleTotals;
  saleItems: SaleItem[];
  softwareId: string;
  softwareSecurityCode: string;
  resolutionAuthNumber: string;
  resolutionPeriodStart: string;
  resolutionPeriodEnd: string;
  resolutionPrefix: string;
  resolutionRangeFrom: number;
  resolutionRangeTo: number;
  clTec: string;
  environment: string;
}

function toDec(value: any): string {
  if (value === null || value === undefined) return '0.00';
  const num = typeof value.toNumber === 'function' ? value.toNumber() : Number(value);
  if (isNaN(num)) return '0.00';
  return num.toFixed(2);
}

function isPositiveAmount(amount: any): boolean {
  return parseFloat(toDec(amount)) > 0;
}

export class UblInvoiceBuilder {
  constructor(private readonly cufeCalculator: CufeCalculator) {}

  build(params: BuildParams): string {
    // Compute the CUFE with the confirmed DIAN formula.
    const taxAmounts = (params.sale.taxAmounts ?? []).map((t) => ({
      code: t.code,
      amount: toDec(t.amount),
    }));
    const cufe = this.cufeCalculator.computeCufe({
      fullNumber: params.fullNumber,
      issueDate: params.issueDate,
      issueTime: params.issueTime,
      subtotal: toDec(params.sale.subtotal),
      taxAmounts,
      totalAmount: toDec(params.sale.totalAmount),
      issuerNit: params.issuerConfig.nit,
      customerId: params.customerParty?.identificationNumber ?? FINAL_CONSUMER_ID,
      clTec: params.clTec,
      environment: params.environment,
    });

    const doc = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('Invoice', {
        xmlns: UBL_NS,
        'xmlns:cac': CAC_NS,
        'xmlns:cbc': CBC_NS,
        'xmlns:ext': EXT_NS,
      });

    this.appendExtensions(doc, params, cufe);
    this.appendDocumentIdentity(doc, params, cufe);
    this.appendSupplierParty(doc, params.issuerConfig);
    this.appendCustomerParty(doc, params.customerParty);
    this.appendTaxTotal(doc, params.sale);
    this.appendLegalMonetaryTotal(doc, params.sale);
    params.saleItems.forEach((item, i) => this.appendInvoiceLine(doc, item, i + 1));

    return doc.end({ prettyPrint: true });
  }

  // ── DIAN extensions ──────────────────────────────────────────────────
  // Produces exactly two ext:UBLExtension children:
  //   1. sts:DianExtensions (with InvoiceControl, InvoiceSource,
  //      SoftwareProvider, SoftwareSecurityCode, AuthorizationProvider, QRCode)
  //   2. ds:Signature (empty placeholder; populated during XAdES-EPES signing)

  private appendExtensions(doc: any, params: BuildParams, cufe: string): void {
    const exts = doc.ele('ext:UBLExtensions');

    // ── First extension: DianExtensions ──
    const ext1 = exts.ele('ext:UBLExtension');
    const ec1 = ext1.ele('ext:ExtensionContent');
    const dian = ec1.ele('sts:DianExtensions', { 'xmlns:sts': STS_NS });

    // InvoiceControl
    const control = dian.ele('sts:InvoiceControl');
    control.ele('sts:InvoiceAuthorization').txt(params.resolutionAuthNumber).up();
    const period = control.ele('sts:AuthorizationPeriod');
    period.ele('cbc:StartDate').txt(params.resolutionPeriodStart).up();
    period.ele('cbc:EndDate').txt(params.resolutionPeriodEnd).up();
    period.up();
    const authInv = control.ele('sts:AuthorizedInvoices');
    authInv.ele('sts:Prefix').txt(params.resolutionPrefix).up();
    authInv.ele('sts:From').txt(String(params.resolutionRangeFrom)).up();
    authInv.ele('sts:To').txt(String(params.resolutionRangeTo)).up();
    authInv.up();
    control.up();

    // InvoiceSource — fixed CO country code
    const source = dian.ele('sts:InvoiceSource');
    source
      .ele('cbc:IdentificationCode', {
        listAgencyID: COUNTRY_LIST_AGENCY_ID,
        listAgencyName: COUNTRY_LIST_AGENCY_NAME,
        listSchemeURI: COUNTRY_LIST_SCHEME_URI,
      })
      .txt('CO')
      .up();
    source.up();

    // SoftwareProvider — in "software propio" mode, the issuer is the
    // technology provider, so sts:ProviderID reports the issuer's own NIT
    // (not a third-party PT NIT).
    const provider = dian.ele('sts:SoftwareProvider');
    provider
      .ele('sts:ProviderID', {
        schemeAgencyID: AGENCY_ID,
        schemeAgencyName: DIAN_AGENCY_NAME,
        schemeID: params.issuerConfig.verificationDigit,
        schemeName: '31',
      })
      .txt(params.issuerConfig.nit)
      .up();
    provider
      .ele('sts:softwareID', {
        schemeAgencyID: AGENCY_ID,
        schemeAgencyName: DIAN_AGENCY_NAME,
      })
      .txt(params.softwareId)
      .up();
    provider.up();

    // SoftwareSecurityCode — 48-character DIAN fingerprint from the secret store
    dian
      .ele('sts:SoftwareSecurityCode', {
        schemeAgencyID: AGENCY_ID,
        schemeAgencyName: DIAN_AGENCY_NAME,
      })
      .txt(params.softwareSecurityCode)
      .up();

    // AuthorizationProvider — fixed DIAN NIT
    const authProv = dian.ele('sts:AuthorizationProvider');
    authProv
      .ele('sts:AuthorizationProviderID', {
        schemeAgencyID: AGENCY_ID,
        schemeAgencyName: DIAN_AGENCY_NAME,
        schemeID: DIAN_VERIFICATION_DIGIT,
        schemeName: '31',
      })
      .txt(DIAN_NIT)
      .up();
    authProv.up();

    // QRCode — URL template with the document's own CUFE substituted
    dian.ele('sts:QRCode').txt(QR_CODE_URL_TEMPLATE + cufe).up();

    ec1.up();
    ext1.up();

    // ── Second extension: ds:Signature placeholder ──
    // The actual XAdES-EPES signature is injected by the DIAN SDK during
    // signAndSend. The Id attribute follows the convention "xmldsig-" + fullNumber.
    const ext2 = exts.ele('ext:UBLExtension');
    const ec2 = ext2.ele('ext:ExtensionContent');
    ec2
      .ele('ds:Signature', {
        'xmlns:ds': DS_NS,
        Id: `xmldsig-${params.fullNumber}`,
      })
      .up();
    ec2.up();
    ext2.up();

    exts.up();
  }

  private appendDocumentIdentity(doc: any, params: BuildParams, cufe: string): void {
    doc.ele('cbc:UBLVersionID').txt(UBL_VERSION).up();
    doc.ele('cbc:CustomizationID').txt(CUSTOMIZATION_ID).up();
    doc.ele('cbc:ProfileID').txt(PROFILE_ID).up();
    doc.ele('cbc:ProfileExecutionID').txt(PROFILE_EXECUTION_ID).up();
    doc.ele('cbc:ID').txt(params.fullNumber).up();
    doc.ele('cbc:UUID', { schemeName: CUFE_SCHEME_NAME }).txt(cufe).up();
    doc.ele('cbc:IssueDate').txt(params.issueDate).up();
    doc.ele('cbc:IssueTime').txt(params.issueTime).up();
    doc
      .ele('cbc:InvoiceTypeCode')
      .txt(params.documentType === 'INVOICE' ? DOC_TYPE_INVOICE : DOC_TYPE_CREDIT_NOTE)
      .up();
    doc.ele('cbc:DocumentCurrencyCode').txt(CURRENCY).up();
  }

  private appendSupplierParty(doc: any, config: IssuerConfig): void {
    const sup = doc.ele('cac:AccountingSupplierParty');
    sup
      .ele('cbc:AdditionalAccountID', { schemeAgencyID: AGENCY_ID })
      .txt(config.nit)
      .up();

    const party = sup.ele('cac:Party');
    party.ele('cac:PartyName').ele('cbc:RegistrationName').txt(config.businessName).up().up();

    this.appendAddress(
      party.ele('cac:PhysicalLocation').ele('cac:Address'),
      { city: config.municipality, department: config.department, country: 'CO' },
    );

    const tax = party.ele('cac:PartyTaxScheme');
    tax.ele('cbc:RegistrationName').txt(config.businessName).up();
    tax
      .ele('cbc:CompanyID', {
        schemeAgencyID: AGENCY_ID,
        schemeID: config.verificationDigit,
        schemeName: '31',
      })
      .txt(config.nit)
      .up();
    tax.ele('cac:TaxScheme').ele('cbc:ID').txt(TAX_SCHEME_IVA).up().up();
    tax.up();

    party
      .ele('cac:PartyLegalEntity')
      .ele('cbc:RegistrationName')
      .txt(config.businessName)
      .up()
      .up();

    this.appendContact(party, { phone: config.phone, email: config.email });
    party.up();
    sup.up();
  }

  private appendCustomerParty(doc: any, customer: CustomerPartyData | null): void {
    const cust = doc.ele('cac:AccountingCustomerParty');
    if (customer) {
      cust
        .ele('cbc:AdditionalAccountID', { schemeAgencyID: AGENCY_ID })
        .txt(customer.identificationNumber ?? '')
        .up();
      this.appendIdentifiedCustomer(cust, customer);
    } else {
      this.appendGenericConsumer(cust);
    }
    cust.up();
  }

  private appendIdentifiedCustomer(cust: any, customer: CustomerPartyData): void {
    const party = cust.ele('cac:Party');
    const schemeId = IDENTIFICATION_TYPE_MAP[customer.identificationType ?? ''] ?? '13';

    party
      .ele('cac:PartyIdentification')
      .ele('cbc:ID', { schemeAgencyID: AGENCY_ID, schemeID: schemeId })
      .txt(customer.identificationNumber ?? '')
      .up()
      .up();

    if (customer.fullName) {
      party.ele('cac:PartyName').ele('cbc:Name').txt(customer.fullName).up().up();
    }

    this.appendAddress(
      party.ele('cac:PhysicalLocation').ele('cac:Address'),
      { city: customer.municipality, department: customer.department, country: 'CO' },
    );

    this.appendContact(party, { phone: customer.phone, email: customer.email });
    party.up();
  }

  // ── Final-consumer identity per DIAN annex v1.9, numeral 6.1 ──
  // When the sale has no registered client, the customer party is populated
  // with the standardised values below rather than branching into a different
  // document type (POS_TICKET). This ensures every sale produces an INVOICE
  // that a credit note can reference unambiguously.
  // Fields:
  //   cbc:AdditionalAccountID = "2"
  //   cbc:ID (PartyIdentification) = "222222222222" with @schemeName = "13", no @schemeID
  //   cbc:CompanyID (PartyTaxScheme) = "222222222222" with @schemeName = "13", no @schemeID
  //   cbc:RegistrationName = "consumidor final"
  //   cbc:TaxLevelCode = "R-99-PN"
  private appendGenericConsumer(cust: any): void {
    cust
      .ele('cbc:AdditionalAccountID')
      .txt(FINAL_CONSUMER_ADDITIONAL_ACCOUNT_ID)
      .up();

    const party = cust.ele('cac:Party');

    // PartyIdentification with @schemeName = 13 (not 31 = NIT), no @schemeID
    party
      .ele('cac:PartyIdentification')
      .ele('cbc:ID', { schemeName: FINAL_CONSUMER_SCHEME_NAME })
      .txt(FINAL_CONSUMER_ID)
      .up()
      .up();

    party
      .ele('cac:PartyName')
      .ele('cbc:Name')
      .txt(FINAL_CONSUMER_REGISTRATION_NAME)
      .up()
      .up();

    const taxScheme = party.ele('cac:PartyTaxScheme');
    taxScheme
      .ele('cbc:RegistrationName')
      .txt(FINAL_CONSUMER_REGISTRATION_NAME)
      .up();
    taxScheme
      .ele('cbc:CompanyID', { schemeName: FINAL_CONSUMER_SCHEME_NAME })
      .txt(FINAL_CONSUMER_ID)
      .up();
    taxScheme
      .ele('cbc:TaxLevelCode')
      .txt(FINAL_CONSUMER_TAX_LEVEL_CODE)
      .up();
    taxScheme.ele('cac:TaxScheme').ele('cbc:ID').txt(TAX_SCHEME_IVA).up().up();
    taxScheme.up();

    party.up();
  }

  private appendTaxTotal(doc: any, sale: SaleTotals): void {
    const tt = doc.ele('cac:TaxTotal');
    tt.ele('cbc:TaxAmount', { currencyID: CURRENCY }).txt(toDec(sale.totalTax)).up();

    const sub = tt.ele('cac:TaxSubtotal');
    sub.ele('cbc:TaxableAmount', { currencyID: CURRENCY }).txt(toDec(sale.subtotal)).up();
    sub.ele('cbc:TaxAmount', { currencyID: CURRENCY }).txt(toDec(sale.totalTax)).up();

    const cat = sub.ele('cac:TaxCategory');
    cat.ele('cbc:ID').txt(TAX_CATEGORY_IVA).up();
    cat.ele('cbc:Percent').txt(IVA_PERCENT_DEFAULT).up();
    cat.ele('cac:TaxScheme').ele('cbc:ID').txt(TAX_SCHEME_IVA).up().up();
    cat.up();
    sub.up();
    tt.up();
  }

  private appendLegalMonetaryTotal(doc: any, sale: SaleTotals): void {
    const t = doc.ele('cac:LegalMonetaryTotal');
    this.appendMonetaryAmount(t, 'cbc:LineExtensionAmount', sale.subtotal);
    this.appendMonetaryAmount(t, 'cbc:TaxExclusiveAmount', sale.subtotal);
    this.appendMonetaryAmount(t, 'cbc:TaxInclusiveAmount', sale.totalAmount);
    this.appendMonetaryAmount(t, 'cbc:AllowanceTotalAmount', sale.totalDiscount);
    this.appendMonetaryAmount(t, 'cbc:PrepaidAmount', '0.00');
    this.appendMonetaryAmount(t, 'cbc:PayableAmount', sale.totalAmount);
    t.up();
  }

  private appendInvoiceLine(doc: any, item: SaleItem, lineNum: number): void {
    const line = doc.ele('cac:InvoiceLine');
    line.ele('cbc:ID').txt(String(lineNum)).up();
    line.ele('cbc:InvoicedQuantity', { unitCode: UNIT_CODE }).txt(String(item.quantity)).up();
    this.appendMonetaryAmount(line, 'cbc:LineExtensionAmount', item.subtotal);

    if (item.discountAmount && isPositiveAmount(item.discountAmount)) {
      const ch = line.ele('cac:AllowanceCharge');
      ch.ele('cbc:ChargeIndicator').txt('false').up();
      this.appendMonetaryAmount(ch, 'cbc:Amount', item.discountAmount);
      ch.up();
    }

    const lt = line.ele('cac:TaxTotal');
    this.appendMonetaryAmount(lt, 'cbc:TaxAmount', item.taxAmount);
    const ls = lt.ele('cac:TaxSubtotal');
    this.appendMonetaryAmount(ls, 'cbc:TaxableAmount', item.subtotal);
    this.appendMonetaryAmount(ls, 'cbc:TaxAmount', item.taxAmount);
    const cat = ls.ele('cac:TaxCategory');
    cat.ele('cbc:ID').txt(TAX_CATEGORY_IVA).up();
    cat.ele('cbc:Percent').txt(toDec(item.taxRate)).up();
    cat.ele('cac:TaxScheme').ele('cbc:ID').txt(TAX_SCHEME_IVA).up().up();
    cat.up();
    ls.up();
    lt.up();

    const iEl = line.ele('cac:Item');
    iEl
      .ele('cbc:Description')
      .txt(item.productCommercialNameSnapshot || item.productGenericNameSnapshot || '')
      .up();
    iEl
      .ele('cac:SellersItemIdentification')
      .ele('cbc:ID')
      .txt(item.productInternalCodeSnapshot ?? '')
      .up()
      .up();
    this.appendMonetaryAmount(iEl.ele('cac:Price'), 'cbc:PriceAmount', item.unitPrice);
    iEl.up();

    line.up();
  }

  private appendMonetaryAmount(parent: any, element: string, value: any): void {
    parent.ele(element, { currencyID: CURRENCY }).txt(toDec(value)).up();
  }

  private appendAddress(
    addressNode: any,
    location: { city?: string; department?: string; country: string },
  ): void {
    if (location.city) {
      addressNode.ele('cbc:ID').txt(location.city).up();
      addressNode.ele('cbc:CityName').txt(location.city).up();
    }
    if (location.department) {
      addressNode.ele('cbc:CountrySubentity').txt(location.department).up();
    }
    addressNode
      .ele('cbc:Country', { schemeAgencyID: AGENCY_ID })
      .ele('cbc:IdentificationCode')
      .txt(location.country)
      .up()
      .up();
    addressNode.up();
  }

  private appendContact(
    partyNode: any,
    contact: { phone?: string; email?: string },
  ): void {
    if (!contact.phone && !contact.email) return;
    const c = partyNode.ele('cac:Contact');
    if (contact.phone) c.ele('cbc:Telephone').txt(contact.phone).up();
    if (contact.email) c.ele('cbc:ElectronicMail').txt(contact.email).up();
    c.up();
  }
}
