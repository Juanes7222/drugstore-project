import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogoMark } from './icons';

const LEGAL_LINKS = [
  { to: '/terminos', key: 'footer.legal_terms' },
  { to: '/privacidad', key: 'footer.legal_privacy' },
  { to: '/datos-personales', key: 'footer.legal_data' },
] as const;

/** Dark footer with the contact slot, legal routes and the brand sign-off. */
export function SiteFooter() {
  const { t } = useTranslation();
  const supportEmail = t('support.channel_email');

  return (
    <footer className="bg-tinta text-papel">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <p className="flex items-center gap-2.5 font-semibold">
              <LogoMark className="text-xl" />
              <span className="display text-lg">{t('brand.name')}</span>
            </p>
            <p className="mt-3 text-sm leading-relaxed text-papel/60">
              {t('brand.tagline')}
            </p>
            {/* Renders only once a real channel is configured — never ship a
                placeholder address to a live marketing site. */}
            {supportEmail ? (
              <p className="mt-4 text-sm">
                <a
                  href={`mailto:${supportEmail}`}
                  className="underline-offset-4 hover:text-menta hover:underline"
                >
                  {t('support.channel_label')}: {supportEmail}
                </a>
              </p>
            ) : null}
          </div>

          <nav aria-label={t('footer.legal_terms')}>
            <ul className="space-y-2.5 text-sm">
              {LEGAL_LINKS.map((link) => (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    className="underline-offset-4 hover:text-menta hover:underline"
                  >
                    {t(link.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-papel/15 pt-6 text-xs text-papel/50 sm:flex-row sm:items-center sm:justify-between">
          <p>{t('footer.rights', { year: new Date().getFullYear() })}</p>
          <p className="data">{t('footer.made_in')}</p>
        </div>
        <p className="mt-4 max-w-xl text-xs leading-relaxed text-papel/40">
          {t('footer.disclaimer')}
        </p>
      </div>
    </footer>
  );
}
