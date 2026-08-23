/**
 * Unit tests for CompanyProfileService — setup status resolution, draft
 * validation, server submit (with local store mirroring) and profile fetch.
 *
 * The HTTP boundary is a mock client; stores are real so the mirroring
 * side effects are asserted on actual state.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  CompanyProfileService,
  CompanyProfileHttpError,
  formatNit,
  mapRegimenToTaxLevelCode,
  type CompanyProfileHttpClient,
  type IssuerConfigPayload,
} from './company-profile.service';
import {
  CompanyNotConfiguredException,
  CompanySubmitOfflineException,
  CompanySubmitRejectedException,
  InvalidNitDvException,
} from './exceptions';
import { useCompanySetupStore } from './company.store';
import { useLocalConfigStore, DEFAULT_SELLER_INFO } from '../configuration/local-config.store';
import type { CompanyDraft } from './company-types';

// ---------------------------------------------------------------------------
// Fixture helpers — independent modulo-11 DV computation so valid-NIT
// fixtures never validate the production implementation against itself.
// ---------------------------------------------------------------------------

const WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

function computeVerificationDigit(nitDigits: string): string {
  let sum = 0;
  for (let i = 0; i < nitDigits.length; i += 1) {
    const digit = Number(nitDigits[nitDigits.length - 1 - i]);
    sum += digit * WEIGHTS[i % WEIGHTS.length];
  }
  const remainder = sum % 11;
  if (remainder === 0) return '0';
  const digit = 11 - remainder;
  return digit === 10 ? '9' : String(digit);
}

const NIT = '900123456';
const DV = computeVerificationDigit(NIT);

const makeDraft = (overrides: Partial<CompanyDraft> = {}): CompanyDraft => ({
  nit: NIT,
  dv: DV,
  name: 'FARMACIA LOS ANDES S.A.S.',
  regimen: 'RÉGIMEN COMÚN',
  organizationType: 'PERSONA JURÍDICA',
  ciiu: '4773',
  municipio: 'MEDELLÍN',
  municipioCode: '05001',
  departamento: 'ANTIOQUIA',
  address: 'CRA 45 # 12-34',
  phone: '604 444 5678',
  email: 'contacto@farmaciaandesa.com',
  resolutionNumber: '18760000001234',
  resolutionDate: '2026-01-15',
  resolutionPrefix: 'FE',
  resolutionRangeStart: '1000',
  resolutionRangeEnd: '1999',
  ...overrides,
});

const BASE_URL = 'http://api.test';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CompanyProfileService', () => {
  let http: CompanyProfileHttpClient;
  let service: CompanyProfileService;

  beforeEach(() => {
    localStorage.clear();
    useCompanySetupStore.getState().reset();
    useLocalConfigStore.getState().updateSellerInfo(DEFAULT_SELLER_INFO);
    http = { get: vi.fn(), patch: vi.fn() };
    service = new CompanyProfileService({
      baseUrl: `${BASE_URL}/`,
      httpClient: http,
      accessToken: 'tok-1',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('resolveSetupStatus', () => {
    it('returns complete when the company store already knows the profile', () => {
      useCompanySetupStore.getState().markComplete(makeDraft());

      expect(service.resolveSetupStatus()).toBe('complete');
    });

    it('returns needs-setup when the local seller info is the placeholder', () => {
      expect(service.resolveSetupStatus()).toBe('needs-setup');
    });

    it('returns complete when a real seller identity is configured locally', () => {
      useLocalConfigStore.getState().updateSellerInfo({
        nit: '900.123.456',
        name: 'FARMACIA LOS ANDES S.A.S.',
      });

      expect(service.resolveSetupStatus()).toBe('complete');
    });
  });

  describe('validateDraft', () => {
    it('throws InvalidNitDvException when the verification digit does not match', () => {
      const draft = makeDraft({ dv: '9' });

      expect(() => service.validateDraft(draft)).toThrow(
        InvalidNitDvException,
      );
    });

    it('throws CompanyNotConfiguredException when a required field is an empty string', () => {
      const draft = makeDraft({ name: '' });

      expect(() => service.validateDraft(draft)).toThrow(
        CompanyNotConfiguredException,
      );
    });

    it('throws CompanyNotConfiguredException when a required field is null', () => {
      const draft = makeDraft({ address: null });

      expect(() => service.validateDraft(draft)).toThrow(
        CompanyNotConfiguredException,
      );
    });

    it('throws CompanyNotConfiguredException when the resolution prefix is missing', () => {
      const draft = makeDraft({ resolutionPrefix: '' });

      expect(() => service.validateDraft(draft)).toThrow(
        CompanyNotConfiguredException,
      );
    });

    it('accepts a complete draft with a valid NIT-DV pair', () => {
      expect(() => service.validateDraft(makeDraft())).not.toThrow();
    });
  });

  describe('submitCompany', () => {
    it('PATCHes the mapped issuer payload and mirrors it into the local stores', async () => {
      vi.mocked(http.patch).mockResolvedValue({});

      await service.submitCompany(makeDraft());

      expect(http.patch).toHaveBeenCalledWith(
        `${BASE_URL}/fiscal-dian/issuer-config`,
        {
          nit: NIT,
          verificationDigit: DV,
          businessName: 'FARMACIA LOS ANDES S.A.S.',
          organizationType: 'PERSONA JURÍDICA',
          taxRegime: 'R-99-PJ',
          address: 'CRA 45 # 12-34',
          municipality: 'MEDELLÍN',
          municipioCode: '05001',
          department: 'ANTIOQUIA',
          phone: '604 444 5678',
          email: 'contacto@farmaciaandesa.com',
          ciiu: '4773',
        },
        { Authorization: 'Bearer tok-1' },
      );

      const seller = useLocalConfigStore.getState().sellerInfo;
      expect(seller.nit).toBe('900.123.456');
      expect(seller.name).toBe('FARMACIA LOS ANDES S.A.S.');
      expect(seller.address).toBe('CRA 45 # 12-34');
      expect(seller.resolutionPrefix).toBe('FE');

      const company = useCompanySetupStore.getState();
      expect(company.status).toBe('complete');
      expect(company.draft?.nit).toBe(NIT);
      expect(company.lastSavedAt).not.toBeNull();
    });

    it('maps a simplified regimen to R-99-PN-SIM', async () => {
      vi.mocked(http.patch).mockResolvedValue({});

      await service.submitCompany(
        makeDraft({ regimen: 'RÉGIMEN SIMPLIFICADO', organizationType: null }),
      );

      const payload = vi.mocked(http.patch).mock.calls[0][1] as IssuerConfigPayload;
      expect(payload.taxRegime).toBe('R-99-PN-SIM');
    });

    it('throws CompanySubmitOfflineException without calling the server when offline', async () => {
      vi.stubGlobal('navigator', { onLine: false });

      await expect(service.submitCompany(makeDraft())).rejects.toThrow(
        CompanySubmitOfflineException,
      );

      expect(http.patch).not.toHaveBeenCalled();
    });

    it('throws CompanySubmitRejectedException when the server rejects the payload', async () => {
      vi.mocked(http.patch).mockRejectedValue(new Error('validation failed'));

      await expect(service.submitCompany(makeDraft())).rejects.toThrow(
        CompanySubmitRejectedException,
      );
    });

    it('does not touch the server when the draft fails validation', async () => {
      await expect(
        service.submitCompany(makeDraft({ dv: '9' })),
      ).rejects.toThrow(InvalidNitDvException);

      expect(http.patch).not.toHaveBeenCalled();
    });
  });

  describe('fetchCompanyProfile', () => {
    it('maps an existing issuer config into a company draft', async () => {
      vi.mocked(http.get).mockResolvedValue({
        nit: '900.123.456',
        verificationDigit: DV,
        businessName: 'FARMACIA LOS ANDES S.A.S.',
        organizationType: 'PERSONA JURÍDICA',
        taxRegime: 'R-99-PJ',
        address: 'CRA 45 # 12-34',
        municipality: 'MEDELLÍN',
        municipioCode: '05001',
        department: 'ANTIOQUIA',
        phone: '604 444 5678',
        email: 'contacto@farmaciaandesa.com',
        ciiu: '4773',
      } satisfies IssuerConfigPayload);

      const draft = await service.fetchCompanyProfile();

      expect(http.get).toHaveBeenCalledWith(
        `${BASE_URL}/fiscal-dian/issuer-config`,
        { Authorization: 'Bearer tok-1' },
      );
      expect(draft).toEqual({
        nit: NIT,
        dv: DV,
        name: 'FARMACIA LOS ANDES S.A.S.',
        regimen: 'RÉGIMEN COMÚN - PERSONA JURÍDICA',
        organizationType: 'PERSONA JURÍDICA',
        ciiu: '4773',
        municipio: 'MEDELLÍN',
        municipioCode: '05001',
        departamento: 'ANTIOQUIA',
        address: 'CRA 45 # 12-34',
        phone: '604 444 5678',
        email: 'contacto@farmaciaandesa.com',
        resolutionNumber: null,
        resolutionDate: null,
        resolutionPrefix: 'FE',
        resolutionRangeStart: null,
        resolutionRangeEnd: null,
      });
    });

    it('returns null when the server has no profile (404)', async () => {
      vi.mocked(http.get).mockRejectedValue(
        new CompanyProfileHttpError(
          `${BASE_URL}/fiscal-dian/issuer-config`,
          404,
          'not found',
        ),
      );

      await expect(service.fetchCompanyProfile()).resolves.toBeNull();
    });

    it('returns null on unexpected server errors', async () => {
      vi.mocked(http.get).mockRejectedValue(
        new CompanyProfileHttpError(
          `${BASE_URL}/fiscal-dian/issuer-config`,
          500,
          'boom',
        ),
      );

      await expect(service.fetchCompanyProfile()).resolves.toBeNull();
    });

    it('returns null without calling the server when offline', async () => {
      vi.stubGlobal('navigator', { onLine: false });

      await expect(service.fetchCompanyProfile()).resolves.toBeNull();

      expect(http.get).not.toHaveBeenCalled();
    });

    it('returns null without calling the server without an access token', async () => {
      const anonymousService = new CompanyProfileService({
        baseUrl: BASE_URL,
        httpClient: http,
      });

      await expect(anonymousService.fetchCompanyProfile()).resolves.toBeNull();

      expect(http.get).not.toHaveBeenCalled();
    });
  });
});

describe('formatNit', () => {
  it('groups a 9-digit NIT as 3-3-3', () => {
    expect(formatNit('900123456')).toBe('900.123.456');
  });

  it('groups a 10-digit NIT as 3-3-3-1', () => {
    expect(formatNit('9012345678')).toBe('901.234.567.8');
  });

  it('sanitizes formatting from the input before grouping', () => {
    expect(formatNit('900.123.456')).toBe('900.123.456');
  });
});

describe('mapRegimenToTaxLevelCode', () => {
  it('maps a common regimen with a legal entity to R-99-PJ', () => {
    expect(mapRegimenToTaxLevelCode('RÉGIMEN COMÚN', 'PERSONA JURÍDICA')).toBe(
      'R-99-PJ',
    );
  });

  it('maps a simplified regimen to R-99-PN-SIM regardless of entity type', () => {
    expect(mapRegimenToTaxLevelCode('RÉGIMEN SIMPLIFICADO', null)).toBe(
      'R-99-PN-SIM',
    );
  });

  it('maps a common regimen with a natural person to R-99-PN', () => {
    expect(mapRegimenToTaxLevelCode('RÉGIMEN COMÚN', 'PERSONA NATURAL')).toBe(
      'R-99-PN',
    );
  });

  it('maps a non-profit entity to R-99-PN-ENT', () => {
    expect(
      mapRegimenToTaxLevelCode('ENTIDAD SIN ÁNIMO DE LUCRO', null),
    ).toBe('R-99-PN-ENT');
  });

  it('matches unaccented regimen and entity text', () => {
    expect(mapRegimenToTaxLevelCode('REGIMEN COMUN', 'PERSONA JURIDICA')).toBe(
      'R-99-PJ',
    );
  });
});