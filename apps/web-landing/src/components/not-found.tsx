import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { ArrowRightIcon } from "./icons";

/**
 * The folio that does not exist, written in the document's own voice rather
 * than as a generic apology.
 *
 * The path the visitor asked for is printed below the message in mono, the same
 * way the rest of the site reports an identifier: a support conversation can
 * start from this page without the visitor having to retype the address.
 */
export function NotFound() {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  return (
    <main id="contenido" className="bg-papel">
      <div className="mx-auto max-w-[78rem] px-5 sm:px-8">
        <div className="rise-in flex items-baseline justify-between gap-4 border-b border-line pb-2 pt-14 lg:pt-20">
          <p className="folio text-verde">{t("not_found.folio")}</p>
          <p className="folio text-grafito">{t("not_found.doc_id")}</p>
        </div>

        <div className="max-w-2xl pt-16 pb-24 lg:pt-24 lg:pb-32">
          <h1 className="display rise-in text-[clamp(2.4rem,5.2vw,4.1rem)]">
            {t("not_found.title")}
          </h1>
          <p
            className="rise-in mt-7 text-lg leading-relaxed text-grafito"
            style={{ "--rise-index": 1 } as CSSProperties}
          >
            {t("not_found.body")}
          </p>

          <p
            className="data rise-in mt-6 text-xs break-all text-grafito"
            style={{ "--rise-index": 2 } as CSSProperties}
          >
            {pathname}
          </p>

          <Link
            to="/"
            className="btn btn-primary rise-in mt-9"
            style={{ "--rise-index": 3 } as CSSProperties}
          >
            {t("not_found.back_home")}
            <ArrowRightIcon className="btn-arrow text-base" />
          </Link>
        </div>
      </div>
    </main>
  );
}
