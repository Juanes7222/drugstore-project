import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { LogoMark, MenuIcon, XIcon } from "./icons";
import { useActiveSection } from "../hooks/use-active-section";
import { useCheckoutStore } from "../stores/checkout-store";

const NAV_ITEMS = [
  { href: "#mostrador", key: "nav.product" },
  { href: "#planes", key: "nav.pricing" },
  { href: "#activacion", key: "nav.activation" },
  { href: "#faq", key: "nav.faq" },
] as const;

// Module-level so the scroll observer is not rebuilt on every render.
const SECTION_IDS = NAV_ITEMS.map((item) => item.href.slice(1));

/**
 * Scroll progress in [0, 1], read inside a requestAnimationFrame so scroll
 * events never re-render React — the bar writes transform directly to the DOM
 * node and updates at most once per frame.
 */
function useScrollProgress(ref: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const bar = ref.current;
    if (!bar) return;

    let frame = 0;

    const updateProgress = () => {
      frame = 0;
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      const progress =
        scrollable > 0
          ? Math.min(Math.max(window.scrollY / scrollable, 0), 1)
          : 0;
      bar.style.transform = `scaleX(${progress})`;
    };

    const scheduleUpdate = () => {
      if (!frame) frame = requestAnimationFrame(updateProgress);
    };

    updateProgress();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [ref]);
}

/** Sticky site header: skip link, section-aware nav, progress bar, buy CTA. */
export function SiteHeader() {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const openCheckout = useCheckoutStore((state) => state.openCheckout);
  const activeSection = useActiveSection(SECTION_IDS);

  useScrollProgress(progressRef);

  const closeMenu = () => setMenuOpen(false);

  return (
    <>
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:bg-verde focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-white"
      >
        {t("a11y.skip_to_content")}
      </a>

      <header className="sticky top-0 z-40 border-b border-line bg-papel/90 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-[78rem] items-center justify-between px-5 sm:px-8">
          <a
            href="#inicio"
            className="flex items-center gap-2.5 font-semibold text-tinta"
          >
            <LogoMark className="text-xl" />
            <span className="display text-lg">{t("brand.name")}</span>
          </a>

          <nav aria-label={t("rail.label")} className="hidden lg:block">
            <ul className="flex items-center gap-7">
              {NAV_ITEMS.map((item) => {
                const isActive = activeSection === item.href.slice(1);
                return (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      aria-current={isActive ? "true" : undefined}
                      className={`text-sm font-medium underline-offset-4 hover:underline ${
                        isActive ? "text-verde" : "text-grafito"
                      }`}
                    >
                      {t(item.key)}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm hidden lg:inline-flex"
              onClick={() => openCheckout("PROVIDER")}
            >
              {t("nav.buy")}
            </button>
            <button
              type="button"
              className="btn btn-secondary px-3 py-2.5 lg:hidden"
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              aria-label={menuOpen ? t("nav.close_menu") : t("nav.open_menu")}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? (
                <XIcon className="text-xl" />
              ) : (
                <MenuIcon className="text-xl" />
              )}
            </button>
          </div>
        </div>

        {/* Reading progress — fills as the visitor advances. transform is
            written imperatively; never re-renders React. */}
        <div
          ref={progressRef}
          aria-hidden="true"
          className="h-0.5 origin-left bg-verde"
          style={{ transform: "scaleX(0)" }}
        />

        {menuOpen && (
          <nav
            id="mobile-menu"
            aria-label={t("rail.label")}
            className="border-t border-line-quiet bg-papel lg:hidden"
          >
            <ul className="mx-auto max-w-[78rem] px-5 py-3 sm:px-8">
              {NAV_ITEMS.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    className="block py-3 text-base font-medium text-tinta"
                    onClick={closeMenu}
                  >
                    {t(item.key)}
                  </a>
                </li>
              ))}
              <li className="pt-2 pb-1">
                <button
                  type="button"
                  className="btn btn-primary w-full"
                  onClick={() => {
                    closeMenu();
                    openCheckout("PROVIDER");
                  }}
                >
                  {t("nav.buy")}
                </button>
              </li>
            </ul>
          </nav>
        )}
      </header>
    </>
  );
}
