import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Tear } from "./tear";

/**
 * The tagline, stated once at display size, as its own moment between two
 * arguments rather than as another section heading.
 *
 * The words open one at a time in reading order as the reader crosses the band,
 * each on its own slice of the tagline's scroll timeline — so this costs no
 * observer, no React state write and no main-thread work during scroll, the
 * same trade every other reveal on this page makes.
 *
 * Nothing carries a hidden resting state: the muted tone lives in the keyframe's
 * `from`, so a visitor without scroll timelines, or who asked for reduced
 * motion, reads the whole sentence at full ink.
 */
export function Thesis() {
  const { t } = useTranslation();
  // Split on spaces only. Punctuation stays glued to its word, and the
  // separator is a normal space so the line still breaks between words.
  const words = t("thesis.title").split(" ");

  return (
    <section
      id="tesis"
      aria-labelledby="thesis-title"
      className="scroll-mt-20 bg-verde text-papel-alto"
    >
      <Tear bite="var(--color-papel-alto)" />

      <div className="mx-auto max-w-[78rem] px-5 pt-16 pb-20 sm:px-8 lg:pt-24 lg:pb-28">
        <h2
          id="thesis-title"
          className="thesis display max-w-4xl text-4xl text-papel-alto lg:text-5xl"
        >
          {words.map((word, index) => (
            <span
              key={`${index}-${word}`}
              className="thesis-word"
              style={{ "--word-index": index } as CSSProperties}
            >
              {word}
              {index < words.length - 1 ? " " : null}
            </span>
          ))}
        </h2>
      </div>
    </section>
  );
}
