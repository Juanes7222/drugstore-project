/**
 * Component tests for Avatar.
 *
 * Covers: initials rendering, image fallback, sizing, coloring, accessibility.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar } from "./avatar.component";

describe("Avatar", () => {
  it("renders initials for a two-word display name", () => {
    render(<Avatar displayName="Juan Pérez" userId="u-1" />);

    const avatar = screen.getByRole("img");
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveTextContent("JP");
  });

  it("renders a single initial for a single-word name", () => {
    render(<Avatar displayName="Beyoncé" userId="u-2" />);

    expect(screen.getByRole("img")).toHaveTextContent("B");
  });

  it("renders an img tag when avatarUrl is provided", () => {
    render(
      <Avatar
        displayName="Juan Pérez"
        avatarUrl="https://example.com/avatar.jpg"
        userId="u-1"
      />,
    );

    const img = screen.getByRole("img");
    expect(img).toBeInstanceOf(HTMLImageElement);
    expect(img).toHaveAttribute("src", "https://example.com/avatar.jpg");
    expect(img).toHaveAttribute("alt", "Juan Pérez");
  });

  it("uses the provided avatarColor instead of generating one", () => {
    render(
      <Avatar
        displayName="María García"
        avatarColor="#FF0000"
        userId="u-1"
        size={40}
      />,
    );

    const div = screen.getByRole("img");
    expect(div).toHaveStyle({ backgroundColor: "#FF0000" });
  });

  it("generates a deterministic color from userId when no avatarColor is set", () => {
    const { container } = render(
      <Avatar displayName="Carlos López" userId="u-1" />,
    );

    // userId "u-1" should yield a specific index from the palette
    const div = container.querySelector('[role="img"]') as HTMLElement;
    const bgColor = div.style.backgroundColor;
    expect(bgColor).toBeTruthy();
    expect(bgColor).not.toBe("");

    // Same userId always produces the same color
    const { container: container2 } = render(
      <Avatar displayName="Otro" userId="u-1" />,
    );
    const div2 = container2.querySelector('[role="img"]') as HTMLElement;
    expect(div2.style.backgroundColor).toBe(bgColor);
  });

  it("applies the size prop as width and height", () => {
    render(<Avatar displayName="Ana" userId="u-3" size={64} />);

    const avatar = screen.getByRole("img") as HTMLElement;
    expect(avatar.style.width).toBe("64px");
    expect(avatar.style.height).toBe("64px");
  });

  it("uses default size of 40 when size is not provided", () => {
    render(<Avatar displayName="Ana" userId="u-3" />);

    const avatar = screen.getByRole("img") as HTMLElement;
    expect(avatar.style.width).toBe("40px");
    expect(avatar.style.height).toBe("40px");
  });

  it("applies the className prop", () => {
    render(
      <Avatar displayName="Test" userId="u-4" className="custom-class" />,
    );

    const avatar = screen.getByRole("img");
    expect(avatar).toHaveClass("custom-class");
  });

  it("sets role=img with an aria-label matching the display name", () => {
    render(<Avatar displayName="Juan Pérez" userId="u-1" />);

    expect(screen.getByRole("img")).toHaveAccessibleName("Juan Pérez");
  });
});
