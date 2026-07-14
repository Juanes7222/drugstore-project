/**
 * Error banner — styled error message for the login page.
 *
 * Renders a simple error text paragraph in the error color.
 */
import { type FC } from 'react';

interface ErrorBannerProps {
  message: string;
}

export const ErrorBanner: FC<ErrorBannerProps> = ({ message }) => (
  <p className="text-sm" style={{ color: 'var(--color-error)' }}>
    {message}
  </p>
);
