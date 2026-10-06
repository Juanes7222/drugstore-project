import type { CSSProperties } from "react";

interface TearProps {
  /**
   * Colour of the surface above - the bites are cut from it, so it must match
   * the section the tear follows or the edge disappears.
   */
  bite: string;
}

/**
 * The page's signature device: a torn edge between two sections. The sweep that
 * tears it open is a view() timeline on `.tear` in global.css, so the edge opens
 * at the reader's pace with no observer of its own.
 */
export function Tear({ bite }: TearProps) {
  return (
    <div aria-hidden="true" className="reveal">
      <div
        className="tear notch mx-auto w-full max-w-[78rem] px-5 sm:px-8"
        style={{ "--notch-color": bite } as CSSProperties}
      />
    </div>
  );
}
