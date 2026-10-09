import type { ReactNode } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

interface PageFrameProps {
  children: ReactNode;
}

/**
 * The document's own chrome: sticky header, page content, back-of-document
 * footer.
 *
 * Declared once so the legal routes and the 404 keep the same frame as the
 * landing — they used to render a bare <main> with no header, no footer and no
 * skip link, which read as a different site rather than a different page.
 */
export function PageFrame({ children }: PageFrameProps) {
  return (
    <>
      <SiteHeader />
      {children}
      <SiteFooter />
    </>
  );
}
