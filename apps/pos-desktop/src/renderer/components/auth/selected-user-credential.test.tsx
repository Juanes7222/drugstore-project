/**
 * Component tests for SelectedUserCredential.
 *
 * Covers: user info display, credential entry chosen from the
 * server-reported hasPin/hasPassword flags (with legacy role heuristic for
 * stale cache entries), method-switch links, change user button, forgot
 * password link, error and countdown display.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoleType } from '@pharmacy/shared-types';
import { SelectedUserCredential } from './selected-user-credential';
import type { LocalUserInfo } from '../../../domain/auth/local-users';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const cashierUser: LocalUserInfo = {
  id: 'user_cashier1',
  displayName: 'María Rodríguez',
  role: RoleType.CASHIER,
  avatarUrl: null,
  avatarColor: '#D97706',
  username: 'cashier1',
};

const cashierWithBothCredentials: LocalUserInfo = {
  ...cashierUser,
  id: 'user_cashier2',
  displayName: 'Carlos Méndez',
  username: 'cmendez',
  hasPin: true,
  hasPassword: true,
};

const cashierWithoutPin: LocalUserInfo = {
  ...cashierUser,
  id: 'user_cashier3',
  displayName: 'Luisa García',
  username: 'lgarcia',
  hasPin: false,
  hasPassword: true,
};

const ownerUser: LocalUserInfo = {
  id: 'user_owner1',
  displayName: 'Juan Pérez',
  role: RoleType.OWNER,
  avatarUrl: null,
  avatarColor: '#5B3E96',
  username: 'owner1',
};

const ownerWithoutPin: LocalUserInfo = {
  ...ownerUser,
  hasPin: false,
  hasPassword: true,
};

const defaultProps = {
  user: cashierUser,
  password: '',
  error: null,
  isLoading: false,
  countdown: 0,
  onPasswordChange: vi.fn(),
  onPinComplete: vi.fn(),
  onPasswordSubmit: vi.fn(),
  onChangeUser: vi.fn(),
  onForgotPassword: vi.fn(),
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('SelectedUserCredential', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the selected user's display name and translated role", () => {
    render(<SelectedUserCredential {...defaultProps} />);

    expect(screen.getByText('María Rodríguez')).toBeInTheDocument();
    expect(screen.getByText('Cajero')).toBeInTheDocument();
  });

  it('renders change-user button with correct accessible name and calls onChangeUser', () => {
    const onChangeUser = vi.fn();
    render(
      <SelectedUserCredential {...defaultProps} onChangeUser={onChangeUser} />,
    );

    const changeBtn = screen.getByRole('button', {
      name: 'Cambiar usuario',
    });
    expect(changeBtn).toBeInTheDocument();

    fireEvent.click(changeBtn);
    expect(onChangeUser).toHaveBeenCalledOnce();
  });

  describe('credential entry (role-based)', () => {
    it('renders PIN keypad with label for CASHIER', () => {
      render(<SelectedUserCredential {...defaultProps} user={cashierUser} />);

      expect(screen.getByText('Ingrese su PIN')).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('••••••••')).not.toBeInTheDocument();
    });

    it('calls onPinComplete when a full PIN is submitted', () => {
      const onPinComplete = vi.fn();
      render(
        <SelectedUserCredential
          {...defaultProps}
          user={cashierUser}
          onPinComplete={onPinComplete}
        />,
      );

      // Type digits into the hidden PIN input, then confirm
      const pinInput = screen.getByLabelText('Ingrese su PIN');
      for (const digit of '1234') {
        fireEvent.keyDown(pinInput, { key: digit });
      }
      fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }));

      expect(onPinComplete).toHaveBeenCalledWith('1234');
    });

    it('renders password input with label for OWNER', () => {
      render(<SelectedUserCredential {...defaultProps} user={ownerUser} />);

      expect(screen.getByText('Contraseña')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();
    });

    it('calls onPasswordChange when the password input changes', () => {
      const onPasswordChange = vi.fn();
      render(
        <SelectedUserCredential
          {...defaultProps}
          user={ownerUser}
          onPasswordChange={onPasswordChange}
        />,
      );

      fireEvent.change(screen.getByPlaceholderText('••••••••'), {
        target: { value: 'newpass' },
      });
      expect(onPasswordChange).toHaveBeenCalledWith('newpass');
    });

    it('calls onPasswordSubmit when Enter is pressed in the password field', () => {
      const onPasswordSubmit = vi.fn();
      render(
        <SelectedUserCredential
          {...defaultProps}
          user={ownerUser}
          onPasswordSubmit={onPasswordSubmit}
        />,
      );

      fireEvent.keyDown(screen.getByPlaceholderText('••••••••'), {
        key: 'Enter',
      });
      expect(onPasswordSubmit).toHaveBeenCalledOnce();
    });

    it('renders forgot-password button and calls onForgotPassword', () => {
      const onForgotPassword = vi.fn();
      render(
        <SelectedUserCredential
          {...defaultProps}
          user={ownerUser}
          onForgotPassword={onForgotPassword}
        />,
      );

      const forgotBtn = screen.getByText('Olvidé mi contraseña');
      expect(forgotBtn).toBeInTheDocument();

      fireEvent.click(forgotBtn);
      expect(onForgotPassword).toHaveBeenCalledOnce();
    });

    it('disables submit button when password is empty', () => {
      render(
        <SelectedUserCredential
          {...defaultProps}
          user={ownerUser}
          password=""
        />,
      );

      expect(screen.getByRole('button', { name: 'Ingresar' })).toBeDisabled();
    });

    it('enables submit button when password is non-empty', () => {
      render(
        <SelectedUserCredential
          {...defaultProps}
          user={ownerUser}
          password="secret"
        />,
      );

      expect(
        screen.getByRole('button', { name: 'Ingresar' }),
      ).not.toBeDisabled();
    });

    it('shows signing-in text and disables button when loading', () => {
      render(
        <SelectedUserCredential
          {...defaultProps}
          user={ownerUser}
          password="secret"
          isLoading
        />,
      );

      expect(screen.getByText('Ingresando...')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Ingresando...' }),
      ).toBeDisabled();
    });

    it('displays error text in the password section', () => {
      render(
        <SelectedUserCredential
          {...defaultProps}
          user={ownerUser}
          error="Usuario o contraseña incorrectos."
        />,
      );

      expect(
        screen.getByText('Usuario o contraseña incorrectos.'),
      ).toBeInTheDocument();
    });

    it('displays lockout countdown when countdown > 0', () => {
      render(
        <SelectedUserCredential
          {...defaultProps}
          user={ownerUser}
          password="secret"
          countdown={125}
        />,
      );

      // 125 seconds → 2 minutes 5 seconds → "Vuelva a intentar en 2:05"
      expect(screen.getByText(/Vuelva a intentar en 2:05/)).toBeInTheDocument();
    });
  });

  describe('credential entry (server-reported flags)', () => {
    it('shows the keypad first with a use-password link when the user has both credentials', () => {
      render(
        <SelectedUserCredential
          {...defaultProps}
          user={cashierWithBothCredentials}
        />,
      );

      expect(screen.getByLabelText('Ingrese su PIN')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Iniciar sesión con contraseña' }),
      ).toBeInTheDocument();
    });

    it('swaps to the password form via the link and offers use-pin back', () => {
      render(
        <SelectedUserCredential
          {...defaultProps}
          user={cashierWithBothCredentials}
        />,
      );

      fireEvent.click(
        screen.getByRole('button', { name: 'Iniciar sesión con contraseña' }),
      );

      expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Usar PIN' }),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText('Ingrese su PIN')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Usar PIN' }));

      expect(screen.getByLabelText('Ingrese su PIN')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Iniciar sesión con contraseña' }),
      ).toBeInTheDocument();
    });

    it('shows the password form directly with no toggle when the cashier has no server PIN', () => {
      render(
        <SelectedUserCredential {...defaultProps} user={cashierWithoutPin} />,
      );

      expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();
      expect(screen.queryByLabelText('Ingrese su PIN')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Iniciar sesión con contraseña' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Usar PIN' }),
      ).not.toBeInTheDocument();
    });

    it('falls back to the role heuristic for stale cache entries but keeps the use-password escape hatch', () => {
      render(<SelectedUserCredential {...defaultProps} user={cashierUser} />);

      expect(screen.getByLabelText('Ingrese su PIN')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Iniciar sesión con contraseña' }),
      ).toBeInTheDocument();
    });

    it('resets the entry mode when a different user is selected', () => {
      const { rerender } = render(
        <SelectedUserCredential
          {...defaultProps}
          user={cashierWithBothCredentials}
        />,
      );

      fireEvent.click(
        screen.getByRole('button', { name: 'Iniciar sesión con contraseña' }),
      );
      expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();

      rerender(
        <SelectedUserCredential
          {...defaultProps}
          user={{ ...cashierWithBothCredentials, id: 'user_cashier4' }}
        />,
      );

      expect(screen.getByLabelText('Ingrese su PIN')).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('••••••••')).not.toBeInTheDocument();
    });

    it('shows the password form with no toggles for an OWNER without a PIN', () => {
      render(
        <SelectedUserCredential {...defaultProps} user={ownerWithoutPin} />,
      );

      expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();
      expect(screen.queryByLabelText('Ingrese su PIN')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Iniciar sesión con contraseña' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Usar PIN' }),
      ).not.toBeInTheDocument();
    });
  });
});
