/**
 * Component tests for GoogleSignInButton.
 *
 * Covers the availability gate (and the divider it takes with it), the
 * idle vs. loading label, click handling, and error surfacing.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GoogleSignInButton } from "./google-signin-button";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// t() returns the key so assertions read as the i18n contract the component
// depends on rather than a locale string.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Strip motion-specific props and force a synchronous mount/unmount so the
// presence assertions do not depend on animation timing.
vi.mock("motion/react", () => ({
  motion: {
    button: ({ children, ...props }: any) => {
      const {
        initial,
        animate,
        exit,
        transition,
        whileHover,
        whileTap,
        ...safeProps
      } = props;
      return <button {...safeProps}>{children}</button>;
    },
    p: ({ children, ...props }: any) => {
      const { initial, animate, exit, transition, ...safeProps } = props;
      return <p {...safeProps}>{children}</p>;
    },
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
  useReducedMotion: () => true,
}));

// ErrorBanner is a plain presentational wrapper; asserting on its own text
// keeps the button tests focused on the wiring, not its animation.
vi.mock("./error-banner", () => ({
  ErrorBanner: ({ message }: { message: string }) => (
    <p role="alert">{message}</p>
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const buildProps = (overrides?: Record<string, unknown>) => ({
  available: true,
  loading: false,
  error: null as string | null,
  onSignIn: vi.fn(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("GoogleSignInButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("availability", () => {
    it("renders nothing when available is false", () => {
      const { container } = render(
        <GoogleSignInButton {...buildProps({ available: false })} />,
      );

      expect(container).toBeEmptyDOMElement();
    });

    it("renders no 'or' divider when available is false", () => {
      render(<GoogleSignInButton {...buildProps({ available: false })} />);

      expect(screen.queryByText("auth.or_divider")).not.toBeInTheDocument();
    });

    it("renders the button when available is true", () => {
      render(<GoogleSignInButton {...buildProps()} />);

      expect(
        screen.getByRole("button", { name: /auth.continue_with_google/ }),
      ).toBeVisible();
    });

    it("renders no error banner while unavailable, even when an error is set", () => {
      render(
        <GoogleSignInButton
          {...buildProps({ available: false, error: "boom" })}
        />,
      );

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("label", () => {
    it("shows the continue label while idle", () => {
      render(<GoogleSignInButton {...buildProps()} />);

      expect(
        screen.getByRole("button", { name: /auth.continue_with_google/ }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /auth.signing_in_with_google/ }),
      ).not.toBeInTheDocument();
    });

    it("swaps to the signing-in label while loading", () => {
      render(<GoogleSignInButton {...buildProps({ loading: true })} />);

      expect(
        screen.getByRole("button", { name: /auth.signing_in_with_google/ }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /auth.continue_with_google/ }),
      ).not.toBeInTheDocument();
    });

    it("keeps the Google brand mark out of the accessible name", () => {
      render(<GoogleSignInButton {...buildProps()} />);

      const button = screen.getByRole("button");
      expect(button).toHaveAccessibleName("auth.continue_with_google");
    });
  });

  describe("loading state", () => {
    it("disables the button while loading", () => {
      render(<GoogleSignInButton {...buildProps({ loading: true })} />);

      expect(
        screen.getByRole("button", { name: /auth.signing_in_with_google/ }),
      ).toBeDisabled();
    });

    it("marks the button busy while loading", () => {
      render(<GoogleSignInButton {...buildProps({ loading: true })} />);

      expect(
        screen.getByRole("button", { name: /auth.signing_in_with_google/ }),
      ).toHaveAttribute("aria-busy", "true");
    });

    it("leaves the button enabled and not busy while idle", () => {
      render(<GoogleSignInButton {...buildProps()} />);

      const button = screen.getByRole("button");
      expect(button).toBeEnabled();
      expect(button).toHaveAttribute("aria-busy", "false");
    });
  });

  describe("interaction", () => {
    it("calls onSignIn when clicked", async () => {
      const props = buildProps();
      const user = userEvent.setup();

      render(<GoogleSignInButton {...props} />);
      await user.click(screen.getByRole("button"));

      expect(props.onSignIn).toHaveBeenCalledTimes(1);
    });

    it("does not call onSignIn when the button is disabled", async () => {
      const props = buildProps({ loading: true });
      const user = userEvent.setup();

      render(<GoogleSignInButton {...props} />);
      // user-event skips pointer events on disabled elements by default, so a
      // plain click is enough to prove the handler is not reachable.
      await user.click(screen.getByRole("button"));

      expect(props.onSignIn).not.toHaveBeenCalled();
    });
  });

  describe("divider", () => {
    it("renders the divider alongside the button", () => {
      render(<GoogleSignInButton {...buildProps()} />);

      expect(screen.getByText("auth.or_divider")).toBeInTheDocument();
      expect(screen.getByRole("button")).toBeInTheDocument();
    });

    it("keeps the divider while loading", () => {
      render(<GoogleSignInButton {...buildProps({ loading: true })} />);

      expect(screen.getByText("auth.or_divider")).toBeInTheDocument();
    });

    it("hides the divider from assistive technology", () => {
      render(<GoogleSignInButton {...buildProps()} />);

      expect(screen.getByText("auth.or_divider").parentElement).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    });
  });

  describe("error", () => {
    it("renders the error message when one is set", () => {
      render(
        <GoogleSignInButton
          {...buildProps({ error: "auth.google_popup_blocked" })}
        />,
      );

      expect(screen.getByRole("alert")).toHaveTextContent(
        "auth.google_popup_blocked",
      );
    });

    it("renders no error banner when error is null", () => {
      render(<GoogleSignInButton {...buildProps({ error: null })} />);

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("keeps the button usable while an error is displayed", () => {
      render(<GoogleSignInButton {...buildProps({ error: "boom" })} />);

      expect(screen.getByRole("button")).toBeEnabled();
    });
  });
});
