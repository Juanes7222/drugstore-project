/**
 * SetupWizardStepWelcome — first step of the printer setup wizard.
 *
 * Displays a warm welcome message, a brief explanation of what the wizard
 * does, and a prominent "Empezar" button.
 */

import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SetupWizardStepWelcomeProps {
  /** Called when the user clicks "Empezar" to start discovery. */
  onStart: () => void;
}

// ---------------------------------------------------------------------------
// Printer icon (inline SVG — avoids an icon dependency for a single use)
// ---------------------------------------------------------------------------

const PrinterIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="56"
    height="56"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.25"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="text-pharma"
    aria-hidden="true"
  >
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6" />
    <rect x="6" y="14" width="12" height="8" rx="1" />
  </svg>
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SetupWizardStepWelcome: FC<SetupWizardStepWelcomeProps> = ({
  onStart,
}) => {
  const { t } = useTranslation();

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="flex h-full flex-col items-center justify-center text-center"
    >
      {/* Icon */}
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-pharma/10">
        <PrinterIcon />
      </div>

      {/* Title */}
      <h1 className="text-heading font-bold text-ink">
        {t(
          'printing.wizard.welcome.title',
          'Configure sus impresoras',
        )}
      </h1>

      {/* Subtitle */}
      <p className="mt-3 max-w-sm text-body text-gray-500">
        {t(
          'printing.wizard.welcome.subtitle',
          'En unos pocos pasos configure las impresoras de su puesto de trabajo. El proceso toma 2–3 minutos y no requiere conocimientos técnicos.',
        )}
      </p>

      {/* Feature list */}
      <ul className="mt-6 space-y-2 text-left text-body-sm text-gray-500">
        {[
          t(
            'printing.wizard.welcome.feature_discovery',
            'Detección automática de impresoras conectadas',
          ),
          t(
            'printing.wizard.welcome.feature_assign',
            'Asignación de tipos de trabajo a cada impresora',
          ),
          t(
            'printing.wizard.welcome.feature_fallback',
            'Configuración de impresora de respaldo',
          ),
          t(
            'printing.wizard.welcome.feature_test',
            'Prueba de impresión para verificar funcionamiento',
          ),
        ].map((feature) => (
          <li key={feature} className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-pharma/60" />
            {feature}
          </li>
        ))}
      </ul>

      {/* Start button */}
      <motion.button
        type="button"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="pos-button pos-button-primary mt-8 px-8 py-3 text-ui font-semibold"
        onClick={onStart}
      >
        {t('printing.wizard.welcome.start', 'Empezar')}
      </motion.button>

      {/* Hint */}
      <p className="mt-4 text-caption text-gray-400">
        {t(
          'printing.wizard.welcome.later_hint',
          'Puede configurar las impresoras más tarde desde el menú de administración.',
        )}
      </p>
    </motion.div>
  );
};
