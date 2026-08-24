import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LogoMark, MenuIcon, XIcon } from './icons';
import { useCheckoutStore } from '../stores/checkout-store';

const NAV_ITEMS = [
  { href: '#producto', key: 'nav.product' },
  { href: '#planes', key: 'nav.pricing' },
  { href: '#faq', key: 'nav.faq' },
] as const;

/** Sticky site header with anchor navigation and the buy CTA. */
export function SiteHeader() {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const openCheckout = useCheckoutStore((state) => state.openCheckout);

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="sticky top-0 z-40 border-b border-tinta/15 bg-papel/90 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a
          href="#inicio"
          className="flex items-center gap-2.5 font-semibold text-tinta"
        >
          <LogoMark className="text-xl" />
          <span className="display text-lg">{t('brand.name')}</span>
        </a>

        <nav aria-label={t('nav.product')} className="hidden md:block">
          <ul className="flex items-center gap-8">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="text-sm font-medium text-tinta-media underline-offset-4 hover:text-verde-cruz hover:underline"
                >
                  {t(item.key)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-primary btn-sm hidden md:inline-flex"
            onClick={() => openCheckout('PROVIDER')}
          >
            {t('nav.buy')}
          </button>
          <button
            type="button"
            className="btn btn-secondary border-transparent px-3 py-2.5 md:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? t('nav.close_menu') : t('nav.open_menu')}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <XIcon className="text-xl" /> : <MenuIcon className="text-xl" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav
          id="mobile-menu"
          aria-label={t('nav.product')}
          className="border-t border-tinta/10 bg-papel md:hidden"
        >
          <ul className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
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
                  openCheckout('PROVIDER');
                }}
              >
                {t('nav.buy')}
              </button>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}
