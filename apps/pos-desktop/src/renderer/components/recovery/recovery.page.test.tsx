/**
 * Component tests for RecoveryPage (thin wiring container).
 *
 * Covers: role guard when user lacks access, rendering RecoveryPageView
 * when user has access, and propagation of handlers.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecoveryPage } from './recovery.page';
import type { UseRecoveryPageReturn } from '../../hooks/use-recovery-page';

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const mockUseRecoveryPage = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../hooks/use-recovery-page', () => ({
  useRecoveryPage: (...args: unknown[]) => mockUseRecoveryPage(...args),
}));

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const buildReturn = (
  overrides: Partial<UseRecoveryPageReturn> = {},
): UseRecoveryPageReturn => ({
  loading: false,
  error: null,
  backups: [],
  logEntries: [],
  healthStatus: 'HEALTHY',
  backupHealth: 'HEALTHY',
  selectedBackup: null,
  verifyReport: null,
  restoreConfirmText: '',
  isRestoring: false,
  isVerifying: null,
  isCreatingBackup: false,
  gapHint: null,
  activeTab: 'backups',
  hasAccess: true,
  setActiveTab: vi.fn(),
  setRestoreConfirmText: vi.fn(),
  handleCreateBackup: vi.fn(),
  handleVerify: vi.fn(),
  handleSelectBackup: vi.fn(),
  handleRestore: vi.fn(),
  handleCancelRestore: vi.fn(),
  handleRefresh: vi.fn(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('RecoveryPage', () => {
  it('renders insufficient_role message when hasAccess is false', () => {
    mockUseRecoveryPage.mockReturnValue(buildReturn({ hasAccess: false }));

    render(<RecoveryPage />);

    expect(screen.getByText('common.insufficient_role')).toBeInTheDocument();
  });

  it('does not render RecoveryPageView when hasAccess is false', () => {
    mockUseRecoveryPage.mockReturnValue(buildReturn({ hasAccess: false }));

    render(<RecoveryPage />);

    // The recovery title should not be rendered
    expect(screen.queryByText('recovery.title')).not.toBeInTheDocument();
  });

  it('renders RecoveryPageView when hasAccess is true', () => {
    mockUseRecoveryPage.mockReturnValue(buildReturn({ hasAccess: true }));

    render(<RecoveryPage />);

    // The page section uses aria-label={t('recovery.title')}
    expect(
      screen.getByRole('region', { name: 'recovery.title' }),
    ).toBeInTheDocument();
  });

  it('passes loading state to view', () => {
    mockUseRecoveryPage.mockReturnValue(buildReturn({ hasAccess: true, loading: true }));

    render(<RecoveryPage />);

    // RecoveryPageView shows loading text when loading is true
    expect(screen.getByText('recovery.loading')).toBeInTheDocument();
  });

  it('passes error state to view', () => {
    mockUseRecoveryPage.mockReturnValue(
      buildReturn({ hasAccess: true, error: 'Disk failure' }),
    );

    render(<RecoveryPage />);

    expect(screen.getByText('Disk failure')).toBeInTheDocument();
  });
});
