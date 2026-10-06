import { useEffect, useState } from "react";

/**
 * Ids of the sections currently in view, in document order. The rail and the
 * header nav both read it, so only one observer watches the page.
 */
export function useActiveSection(ids: readonly string[]): string | null {
  const [activeId, setActiveId] = useState<string | null>(ids[0] ?? null);
  // Keyed on the ids themselves so a caller may pass an inline array.
  const key = ids.join("|");

  useEffect(() => {
    const sections = key
      .split("|")
      .filter(Boolean)
      .map((id) => document.getElementById(id))
      .filter((section): section is HTMLElement => section !== null);

    if (sections.length === 0 || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        }
      },
      // A band around the header's lower edge decides what "current" means.
      { rootMargin: "-25% 0px -65% 0px", threshold: 0 },
    );

    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, [key]);

  return activeId;
}
