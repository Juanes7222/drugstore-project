import { useTranslation } from 'react-i18next';
import type { ComponentType, SVGProps } from 'react';
import {
  BarcodeIcon,
  ClockIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from './icons';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

interface PillarItem {
  icon: string;
  title: string;
  body: string;
}

const ICONS: Record<string, IconComponent> = {
  barcode: BarcodeIcon,
  'shield-check': ShieldCheckIcon,
  clock: ClockIcon,
  'refresh-cw': RefreshCwIcon,
};

/** Four domain pillars rendered as an icon + title + body grid. */
export function Pillars() {
  const { t } = useTranslation();
  const items = t('pillars.items', { returnObjects: true }) as PillarItem[];

  return (
    <section id="producto" aria-labelledby="pillars-title" className="py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 id="pillars-title" className="display max-w-2xl text-3xl font-bold sm:text-4xl">
          {t('pillars.title')}
        </h2>

        <ul className="mt-12 grid gap-x-10 gap-y-12 sm:grid-cols-2">
          {items.map((item) => {
            const Icon = ICONS[item.icon];
            return (
              <li key={item.title} className="max-w-md">
                <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-verde-cruz/25 bg-menta text-xl text-verde-cruz">
                  {Icon ? <Icon /> : null}
                </span>
                <h3 className="display mt-5 text-lg font-bold">{item.title}</h3>
                <p className="mt-2 leading-relaxed text-tinta-media">{item.body}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
