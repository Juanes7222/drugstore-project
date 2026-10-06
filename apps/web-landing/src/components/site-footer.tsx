import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LogoMark } from "./icons";

const LEGAL_LINKS = [
  { to: "/terminos", key: "footer.legal_terms" },
  { to: "/privacidad", key: "footer.legal_privacy" },
  { to: "/datos-personales", key: "footer.legal_data" },
] as const;

/** Dark footer: the back of the document, with the legal routes and sign-off. */
export function SiteFooter() {
  const { t } = useTranslation();
  const supportEmail = t("support.channel_email");

  return (
    <footer className="bg-tinta pb-28 text-papel-alto lg:pb-14">
      <div className="mx-auto max-w-[78rem] px-5 py-14 sm:px-8">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <p className="flex items-center gap-2.5 font-semibold">
              <LogoMark className="text-xl" />
              <span className="display text-lg">{t("brand.name")}</span>
            </p>
            <p className="mt-3 text-sm leading-relaxed text-papel-alto/60">
              {t("brand.tagline")}
            </p>
            {/* Renders only once a real channel is configured — never ship a
                placeholder address to a live marketing site. */}
            {supportEmail ? (
              <p className="mt-4 text-sm">
                <a href={`mailto:${supportEmail}`} className="link-rule">
                  {t("support.channel_label")}: {supportEmail}
                </a>
              </p>
            ) : null}
          </div>

          <nav aria-label={t("footer.legal_terms")}>
            <ul className="space-y-2.5 text-sm">
              {LEGAL_LINKS.map((link) => (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    className="link-rule text-papel-alto/75 hover:text-papel-alto"
                  >
                    {t(link.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-papel-alto/15 pt-6 text-xs text-papel-alto/50 sm:flex-row sm:items-center sm:justify-between">
          <p>{t("footer.rights", { year: new Date().getFullYear() })}</p>
          <p className="data">{t("brand.doc_id")}</p>
        </div>
        <p className="mt-4 max-w-xl text-xs leading-relaxed text-papel-alto/60">
          {t("footer.disclaimer")}
        </p>
      </div>
    </footer>
  );
}
