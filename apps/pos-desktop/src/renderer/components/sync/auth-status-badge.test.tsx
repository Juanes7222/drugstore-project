/**
 * Unit tests for AuthStatusBadge.
 *
 * Verifies that each SyncAuthStatus value renders the expected label text,
 * an SVG icon, and the correct colour group.
 *
 * @module auth-status-badge.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthStatusBadge } from './auth-status-badge';
import { useSyncAuthStatusStore } from '../../../domain/sync/sync-auth-status.store';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('AuthStatusBadge', () => {
  beforeEach(() => {
    useSyncAuthStatusStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------
  // Label text per status
  // -------------------------------------------------------------------

  it('renders "Checking\u2026" for unknown status', () => {
    render(<AuthStatusBadge />);
    expect(screen.getByText('Checking\u2026')).toBeInTheDocument();
  });

  it('renders "Token OK" for fresh status', () => {
    useSyncAuthStatusStore.getState().setFresh();
    render(<AuthStatusBadge />);
    expect(screen.getByText('Token OK')).toBeInTheDocument();
  });

  it('renders "Token Refreshed" for refreshed status', () => {
    useSyncAuthStatusStore.getState().setRefreshed();
    render(<AuthStatusBadge />);
    expect(screen.getByText('Token Refreshed')).toBeInTheDocument();
  });

  it('renders "Token Exchanged" for exchanged status', () => {
    useSyncAuthStatusStore.getState().setExchanged();
    render(<AuthStatusBadge />);
    expect(screen.getByText('Token Exchanged')).toBeInTheDocument();
  });

  it('renders "Auth Error" for failed status', () => {
    useSyncAuthStatusStore.getState().setFailed();
    render(<AuthStatusBadge />);
    expect(screen.getByText('Auth Error')).toBeInTheDocument();
  });

  it('renders "No Session" for no_session status', () => {
    useSyncAuthStatusStore.getState().setNoSession();
    render(<AuthStatusBadge />);
    expect(screen.getByText('No Session')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------
  // SVG icon — every status must render at least one <svg>
  // -------------------------------------------------------------------

  it('renders an SVG icon for unknown status', () => {
    const { container } = render(<AuthStatusBadge />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders an SVG icon for fresh status', () => {
    useSyncAuthStatusStore.getState().setFresh();
    const { container } = render(<AuthStatusBadge />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders an SVG icon for no_session status', () => {
    useSyncAuthStatusStore.getState().setNoSession();
    const { container } = render(<AuthStatusBadge />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------
  // Colour assertions — verify the Tailwind colour group on the badge
  // -------------------------------------------------------------------

  it('applies green colour classes when fresh', () => {
    useSyncAuthStatusStore.getState().setFresh();
    const { container } = render(<AuthStatusBadge />);
    const badge = container.querySelector('[class*="rounded-full"]');
    expect(badge).toBeTruthy();
    expect(badge!.className).toContain('green');
  });

  it('applies blue colour classes when refreshed', () => {
    useSyncAuthStatusStore.getState().setRefreshed();
    const { container } = render(<AuthStatusBadge />);
    const badge = container.querySelector('[class*="rounded-full"]');
    expect(badge).toBeTruthy();
    expect(badge!.className).toContain('blue');
  });

  it('applies indigo colour classes when exchanged', () => {
    useSyncAuthStatusStore.getState().setExchanged();
    const { container } = render(<AuthStatusBadge />);
    const badge = container.querySelector('[class*="rounded-full"]');
    expect(badge).toBeTruthy();
    expect(badge!.className).toContain('indigo');
  });

  it('applies red colour classes when failed', () => {
    useSyncAuthStatusStore.getState().setFailed();
    const { container } = render(<AuthStatusBadge />);
    const badge = container.querySelector('[class*="rounded-full"]');
    expect(badge).toBeTruthy();
    expect(badge!.className).toContain('red');
  });

  it('applies gray colour classes for unknown status', () => {
    const { container } = render(<AuthStatusBadge />);
    const badge = container.querySelector('[class*="rounded-full"]');
    expect(badge).toBeTruthy();
    expect(badge!.className).toContain('gray');
  });

  it('applies gray colour classes for no_session status', () => {
    useSyncAuthStatusStore.getState().setNoSession();
    const { container } = render(<AuthStatusBadge />);
    const badge = container.querySelector('[class*="rounded-full"]');
    expect(badge).toBeTruthy();
    expect(badge!.className).toContain('gray');
  });
});
