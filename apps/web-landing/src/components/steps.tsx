import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Tear } from "./tear";

interface Step {
  title: string;
  body: string;
}

/**
 * The three purchase steps as a drawn rule: the line connects them because the
 * order is real information — pay, receive the code, activate. Numbered, and the
 * numbering is the only marker on the page.
 */
export function Steps() {
  const { t } = useTranslation();
  const items = t("steps.items", { returnObjects: true }) as Step[];

  return (
    <section
      id="activacion"
      aria-labelledby="steps-title"
      className="scroll-mt-20 bg-papel-alto"
    >
      <Tear bite="var(--color-papel)" />

      <div className="mx-auto max-w-[78rem] px-5 pt-12 pb-20 sm:px-8 lg:pt-16 lg:pb-24">
        <p className="folio text-verde">{t("steps.eyebrow")}</p>
        <h2
          id="steps-title"
          className="display mt-5 max-w-2xl text-[clamp(1.8rem,3.4vw,2.5rem)]"
        >
          {t("steps.title")}
        </h2>

        <div className="step-rule mt-14">
          <ol className="grid gap-8 sm:grid-cols-3 sm:gap-10">
            {items.map((step, index) => (
              <li
                key={step.title}
                className="step-node"
                style={{ "--node-index": index } as CSSProperties}
              >
                <span className="data block text-sm font-semibold text-verde">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="display mt-3 text-xl">{step.title}</h3>
                <p className="mt-2 leading-relaxed text-grafito">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
