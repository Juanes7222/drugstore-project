/**
 * Component tests for AvatarGrid.
 *
 * Covers: rendering all users, selection highlighting, click handlers
 * for user selection and "other account" link.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AvatarGrid } from "./avatar-grid";
import { RoleType } from "@pharmacy/shared-types";
import type { LocalUserInfo } from "../../../domain/auth/local-users";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const users: LocalUserInfo[] = [
  {
    id: "owner-1",
    displayName: "Juan Pérez",
    role: RoleType.OWNER,
    avatarUrl: null,
    avatarColor: "#4F46E5",
    username: "juan.perez",
  },
  {
    id: "cashier-1",
    displayName: "Carlos López",
    role: RoleType.CASHIER,
    avatarUrl: null,
    avatarColor: "#D97706",
    username: "carlos.lopez",
  },
];

const defaultProps = {
  users,
  selectedUserId: null,
  onSelect: vi.fn(),
  onOtherAccount: vi.fn(),
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("AvatarGrid", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders all users with their display names and translated roles", () => {
    render(<AvatarGrid {...defaultProps} />);

    expect(screen.getByText("Juan Pérez")).toBeInTheDocument();
    expect(screen.getByText("Carlos López")).toBeInTheDocument();
    expect(screen.getByText("Dueño")).toBeInTheDocument();
    expect(screen.getByText("Cajero")).toBeInTheDocument();
  });

  it("calls onSelect when a user button is clicked", () => {
    const onSelect = vi.fn();
    render(
      <AvatarGrid {...defaultProps} onSelect={onSelect} />,
    );

    fireEvent.click(screen.getByText("Juan Pérez"));
    expect(onSelect).toHaveBeenCalledWith(users[0]);

    fireEvent.click(screen.getByText("Carlos López"));
    expect(onSelect).toHaveBeenCalledWith(users[1]);
  });

  it("renders the 'other account' link and calls onOtherAccount when clicked", () => {
    const onOtherAccount = vi.fn();
    render(
      <AvatarGrid {...defaultProps} onOtherAccount={onOtherAccount} />,
    );

    const otherAccountButton = screen.getByText("Otro usuario");
    expect(otherAccountButton).toBeInTheDocument();

    fireEvent.click(otherAccountButton);
    expect(onOtherAccount).toHaveBeenCalledOnce();
  });

  it("applies a selected border to the matching user", () => {
    const { container } = render(
      <AvatarGrid {...defaultProps} selectedUserId="cashier-1" />,
    );

    // The selected user's button should have a border matching --color-primary
    const userButtons = container.querySelectorAll("button");
    // First two buttons are users, third is "other account"
    const selectedButton = userButtons[1]; // cashier-1 is second
    expect(selectedButton.style.border).toContain("solid");
  });

  it("renders the group with an aria-label from translation", () => {
    render(<AvatarGrid {...defaultProps} />);

    const group = screen.getByRole("group");
    expect(group).toHaveAccessibleName("Seleccionar usuario");
  });
});
