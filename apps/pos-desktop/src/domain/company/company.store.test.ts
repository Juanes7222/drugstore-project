/**
 * Unit tests for the company-setup Zustand store (vanilla store, no React).
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useCompanySetupStore } from './company.store';
import type { CompanyDraft } from './company-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeDraft = (overrides: Partial<CompanyDraft> = {}): CompanyDraft => ({
  nit: '900123456',
  dv: '8',
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCompanySetupStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useCompanySetupStore.getState().reset();
  });

  describe('initial state', () => {
    it('starts idle with no draft and no save timestamp', () => {
      const state = useCompanySetupStore.getState();

      expect(state.status).toBe('idle');
      expect(state.draft).toBeNull();
      expect(state.parsedFromRut).toBeNull();
      expect(state.lastSavedAt).toBeNull();
      expect(state.certificateActive).toBeNull();
    });
  });

  describe('setStatus', () => {
    it('updates the setup lifecycle status', () => {
      useCompanySetupStore.getState().setStatus('needs-setup');

      expect(useCompanySetupStore.getState().status).toBe('needs-setup');
    });
  });

  describe('setDraft', () => {
    it('stores the draft without touching parsedFromRut', () => {
      const draft = makeDraft();

      useCompanySetupStore.getState().setDraft(draft);

      const state = useCompanySetupStore.getState();
      expect(state.draft).toEqual(draft);
      expect(state.parsedFromRut).toBeNull();
    });

    it('accepts null to clear the stored draft', () => {
      useCompanySetupStore.getState().setDraft(makeDraft());
      useCompanySetupStore.getState().setDraft(null);

      expect(useCompanySetupStore.getState().draft).toBeNull();
    });
  });

  describe('setParsedFromRut', () => {
    it('stores the parsed draft in both parsedFromRut and draft', () => {
      const draft = makeDraft();

      useCompanySetupStore.getState().setParsedFromRut(draft);

      const state = useCompanySetupStore.getState();
      expect(state.parsedFromRut).toEqual(draft);
      expect(state.draft).toEqual(draft);
    });
  });

  describe('markComplete', () => {
    it('flips the status to complete and stores the submitted draft', () => {
      const draft = makeDraft();

      useCompanySetupStore.getState().markComplete(draft);

      const state = useCompanySetupStore.getState();
      expect(state.status).toBe('complete');
      expect(state.draft).toEqual(draft);
      expect(state.lastSavedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('setCertificateActive', () => {
    it('stores true when the config pull reports an ACTIVE certificate', () => {
      useCompanySetupStore.getState().setCertificateActive(true);

      expect(useCompanySetupStore.getState().certificateActive).toBe(true);
    });

    it('stores false when the server reports no active certificate', () => {
      useCompanySetupStore.getState().setCertificateActive(false);

      expect(useCompanySetupStore.getState().certificateActive).toBe(false);
    });

    it('keeps a previously known status when updated again', () => {
      useCompanySetupStore.getState().setCertificateActive(true);

      useCompanySetupStore.getState().setCertificateActive(false);

      expect(useCompanySetupStore.getState().certificateActive).toBe(false);
    });
  });

  describe('reset', () => {
    it('returns the store to its idle state', () => {
      useCompanySetupStore.getState().markComplete(makeDraft());
      useCompanySetupStore.getState().setParsedFromRut(makeDraft());

      useCompanySetupStore.getState().reset();

      const state = useCompanySetupStore.getState();
      expect(state.status).toBe('idle');
      expect(state.draft).toBeNull();
      expect(state.parsedFromRut).toBeNull();
      expect(state.lastSavedAt).toBeNull();
    });

    it('clears the certificate status back to unknown', () => {
      useCompanySetupStore.getState().setCertificateActive(true);

      useCompanySetupStore.getState().reset();

      expect(useCompanySetupStore.getState().certificateActive).toBeNull();
    });
  });

  describe('persistence', () => {
    it('writes the store state to localStorage', () => {
      useCompanySetupStore.getState().markComplete(makeDraft());

      const persisted = JSON.parse(
        localStorage.getItem('pharmacy_company_setup') ?? '{}',
      );

      expect(persisted.state.status).toBe('complete');
      expect(persisted.state.draft?.nit).toBe('900123456');
    });

    it('persists the certificate status to localStorage', () => {
      useCompanySetupStore.getState().setCertificateActive(true);

      const persisted = JSON.parse(
        localStorage.getItem('pharmacy_company_setup') ?? '{}',
      );

      expect(persisted.state.certificateActive).toBe(true);
    });

    it('rehydrates a fresh module instance from localStorage', async () => {
      useCompanySetupStore.getState().markComplete(makeDraft());

      vi.resetModules();
      const { useCompanySetupStore: freshStore } = await import('./company.store');

      const state = freshStore.getState();
      expect(state.status).toBe('complete');
      expect(state.draft?.nit).toBe('900123456');
    });
  });
});