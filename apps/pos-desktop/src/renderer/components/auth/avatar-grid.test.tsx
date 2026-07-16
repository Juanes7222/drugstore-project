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
    id: "user_admin",
    displayName: "Administrador del Sistema",
    role: RoleType.ADMIN,
    avatarUrl: null,
    avatarColor: "#4F46E5",
    username: "admin",
  },
  {
    id: "user_cashier1",
    displayName: "María Rodríguez",
    role: RoleType.CASHIER,
    avatarUrl: null,
    avatarColor: "#D97706",
    username: "cashier1",
  },
];

const defaultProps = {
  users,
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

    expect(screen.getByText("Administrador del Sistema")).toBeInTheDocument();
    expect(screen.getByText("María Rodríguez")).toBeInTheDocument();
    expect(screen.getByText("ADMIN")).toBeInTheDocument();
    expect(screen.getByText("Cajero")).toBeInTheDocument();
  });

  it("calls onSelect when a user button is clicked", () => {
    const onSelect = vi.fn();
    render(
      <AvatarGrid {...defaultProps} onSelect={onSelect} />,
    );

    fireEvent.click(screen.getByText("Administrador del Sistema"));
    expect(onSelect).toHaveBeenCalledWith(users[0]);

    fireEvent.click(screen.getByText("María Rodríguez"));
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

  it("renders the group with an aria-label from translation", () => {
    render(<AvatarGrid {...defaultProps} />);

    const group = screen.getByRole("group");
    expect(group).toHaveAccessibleName("Seleccionar usuario");
  });
});
