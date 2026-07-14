import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiscardEntryModal } from "./discard-entry-modal";

describe("DiscardEntryModal", () => {
  const baseProps = {
    entryId: "entry-123",
    discardReason: "",
    onDiscardReasonChange: vi.fn(),
    isSubmitting: false,
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Render structure ──────────────────────────────────────────────

  it("renders the dialog with correct aria attributes", () => {
    render(<DiscardEntryModal {...baseProps} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute(
      "aria-labelledby",
      "discard-modal-title",
    );
  });

  it("renders the title and description text", () => {
    render(<DiscardEntryModal {...baseProps} />);

    expect(
      screen.getByText("Discard Sync Entry"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /This action cannot be undone/i,
      ),
    ).toBeInTheDocument();
  });

  it("renders the reason label and textarea", () => {
    render(<DiscardEntryModal {...baseProps} />);

    expect(
      screen.getByText("Reason for discarding"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: /reason for discarding/i }),
    ).toBeInTheDocument();
  });

  it("renders Cancelar and Discard buttons", () => {
    render(<DiscardEntryModal {...baseProps} />);

    expect(
      screen.getByRole("button", { name: "Cancelar" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Discard" }),
    ).toBeInTheDocument();
  });

  // ── Discard button disabled states ────────────────────────────────

  it("disables Discard button when discardReason is empty", () => {
    render(<DiscardEntryModal {...baseProps} discardReason="" />);

    expect(
      screen.getByRole("button", { name: "Discard" }),
    ).toBeDisabled();
  });

  it("enables Discard button when discardReason is not empty", () => {
    render(
      <DiscardEntryModal
        {...baseProps}
        discardReason="Duplicate entry"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Discard" }),
    ).toBeEnabled();
  });

  it("disables Discard button when isSubmitting is true", () => {
    render(
      <DiscardEntryModal
        {...baseProps}
        discardReason="Duplicate"
        isSubmitting={true}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Discarding/i }),
    ).toBeDisabled();
  });

  // ── Submitting state ──────────────────────────────────────────────

  it("shows 'Discarding…' text when isSubmitting is true", () => {
    render(
      <DiscardEntryModal
        {...baseProps}
        discardReason="Duplicate"
        isSubmitting={true}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Discarding/i }),
    ).toBeInTheDocument();
  });

  it("disables textarea when isSubmitting is true", () => {
    render(
      <DiscardEntryModal
        {...baseProps}
        discardReason="Duplicate"
        isSubmitting={true}
      />,
    );

    expect(
      screen.getByRole("textbox", { name: /reason for discarding/i }),
    ).toBeDisabled();
  });

  it("disables Cancelar button when isSubmitting is true", () => {
    render(
      <DiscardEntryModal
        {...baseProps}
        discardReason="Duplicate"
        isSubmitting={true}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Cancelar" }),
    ).toBeDisabled();
  });

  // ── Interactions ──────────────────────────────────────────────────

  it("calls onDiscardReasonChange when typing in textarea", async () => {
    const user = userEvent.setup();
    const onDiscardReasonChange = vi.fn();

    render(
      <DiscardEntryModal
        {...baseProps}
        onDiscardReasonChange={onDiscardReasonChange}
      />,
    );

    const textarea = screen.getByRole("textbox", {
      name: /reason for discarding/i,
    });
    await user.type(textarea, "Duplicate entry");

    expect(onDiscardReasonChange).toHaveBeenCalled();
    // Called once per character
    expect(onDiscardReasonChange).toHaveBeenCalledWith("D");
  });

  it("calls onSubmit when Discard is clicked", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <DiscardEntryModal
        {...baseProps}
        discardReason="Duplicate"
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when Cancelar is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(
      <DiscardEntryModal
        {...baseProps}
        discardReason="Duplicate"
        onCancel={onCancel}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Cancelar" }),
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onCancel when Cancelar is clicked while submitting", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(
      <DiscardEntryModal
        {...baseProps}
        discardReason="Duplicate"
        isSubmitting={true}
        onCancel={onCancel}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Cancelar" }),
    );
    expect(onCancel).not.toHaveBeenCalled();
  });

  // ── Overlay click ─────────────────────────────────────────────────

  it("calls onCancel when clicking the overlay backdrop", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    const { container } = render(
      <DiscardEntryModal
        {...baseProps}
        discardReason="Duplicate"
        onCancel={onCancel}
      />,
    );

    // The overlay is the outermost div with the fixed positioning
    const overlay = container.firstElementChild!;
    await user.click(overlay);

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onCancel when clicking inside the modal card", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(
      <DiscardEntryModal
        {...baseProps}
        discardReason="Duplicate"
        onCancel={onCancel}
      />,
    );

    // Click the heading inside the card — should not propagate to overlay handler
    await user.click(screen.getByText("Discard Sync Entry"));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("does NOT call onCancel when overlay is clicked while submitting", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    const { container } = render(
      <DiscardEntryModal
        {...baseProps}
        discardReason="Duplicate"
        isSubmitting={true}
        onCancel={onCancel}
      />,
    );

    const overlay = container.firstElementChild!;
    await user.click(overlay);

    expect(onCancel).not.toHaveBeenCalled();
  });

  // ── Whitespace handling ───────────────────────────────────────────

  it("treats whitespace-only reason as empty (Discard disabled)", () => {
    render(
      <DiscardEntryModal
        {...baseProps}
        discardReason="   "
      />,
    );

    expect(
      screen.getByRole("button", { name: "Discard" }),
    ).toBeDisabled();
  });
});
