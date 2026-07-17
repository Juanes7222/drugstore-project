/**
 * ErrorBoundary — catches React render errors and displays a fallback UI
 * instead of letting the crash take down the entire component tree.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <MyComponent />
 *   </ErrorBoundary>
 *
 * An optional `fallback` prop can replace the default error UI.
 * The `onError` callback is called with the error and error info for logging.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "i18next";

// ---------------------------------------------------------------------------
// Props & State
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional custom fallback UI. If not provided, a default is rendered. */
  fallback?: ReactNode | ((error: Error) => ReactNode);
  /** Optional error handler for logging. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary] Caught an error:", error, info);
    this.props.onError?.(error, info);
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) {
        if (typeof this.props.fallback === "function") {
          return this.props.fallback(this.state.error!);
        }
        return this.props.fallback;
      }

      return (
        <div
          role="alert"
          className="flex h-full w-full flex-col items-center justify-center p-8"
          style={{
            backgroundColor: "var(--color-surface)",
            color: "var(--color-ink)",
          }}
        >
          <div
            className="flex flex-col items-center gap-4 max-w-md text-center"
          >
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              style={{ color: "var(--color-error)" }}
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4" strokeLinecap="round" />
              <path d="M12 16h.01" strokeLinecap="round" />
            </svg>

            <h2
              className="text-lg font-semibold"
              style={{ color: "var(--color-ink)" }}
            >
              {t("error_boundary.title", "Something went wrong")}
            </h2>

            <p
              className="text-sm"
              style={{ color: "var(--color-ink-muted)" }}
            >
              {t(
                "error_boundary.description",
                "An unexpected error occurred. Please try again or contact support.",
              )}
            </p>

            {this.state.error && (
              <details
                className="w-full text-xs text-left"
                style={{ color: "var(--color-ink-muted)" }}
              >
                <summary
                  className="cursor-pointer font-medium"
                  style={{ color: "var(--color-ink-muted)" }}
                >
                  {t("error_boundary.details", "Error details")}
                </summary>
                <pre
                  className="mt-2 p-2 rounded overflow-auto max-h-32 text-xs"
                  style={{
                    backgroundColor: "var(--color-surface-variant)",
                    color: "var(--color-error)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {this.state.error.message}
                  {"\n"}
                  {this.state.error.stack}
                </pre>
              </details>
            )}

            <button
              type="button"
              onClick={this.handleRetry}
              className="pos-button pos-button--primary mt-2"
            >
              {t("error_boundary.retry", "Try again")}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
