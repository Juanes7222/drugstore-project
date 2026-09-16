import { useTranslation } from "react-i18next";
import type { CSSProperties } from "react";
import { Reveal } from "./reveal";
import { useReveal } from "../hooks/use-reveal";

interface Step {
  title: string;
  body: string;
}

interface StepItemProps {
  step: Step;
  index: number;
}

/**
 * One purchase step. The reveal lives on the <li> itself so the .reveal CSS
 * and the .step-rule accent both key off the same data-visible attribute.
 */
function StepItem({ step, index }: StepItemProps) {
  const revealRef = useReveal<HTMLLIElement>();

  return (
    <li
      ref={revealRef}
      data-visible="false"
      className="step-rule reveal border-t-2 border-tinta/15 pt-6"
      style={{ "--reveal-index": index } as CSSProperties}
    >
      <span className="data text-sm font-semibold text-verde-cruz">
        {String(index + 1).padStart(2, "0")}
      </span>
      <h3 className="display mt-3 text-lg font-bold">{step.title}</h3>
      <p className="mt-2 leading-relaxed text-tinta-media">{step.body}</p>
    </li>
  );
}

/**
 * The three purchase steps. Numbered because the order is real information:
 * pay → receive code → activate. Each rule draws its green accent as the
 * step reveals — a sequence, told with motion.
 */
export function Steps() {
  const { t } = useTranslation();
  const items = t("steps.items", { returnObjects: true }) as Step[];

  return (
    <section aria-labelledby="steps-title" className="py-20 lg:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal>
          <h2
            id="steps-title"
            className="display text-3xl font-bold sm:text-4xl"
          >
            {t("steps.title")}
          </h2>
        </Reveal>

        <ol className="mt-12 grid gap-8 sm:grid-cols-3">
          {items.map((step, index) => (
            <StepItem key={step.title} step={step} index={index} />
          ))}
        </ol>
      </div>
    </section>
  );
}
