// Temporary codemod: replace inline <svg> blocks with module icon components.
// Each entry maps a file to an ordered list of replacement JSX strings (in
// document order of the <svg> blocks) plus the icon names that must be
// imported from "@/components/ui/icons" and/or the animated module.
import { readFileSync, writeFileSync } from "node:fs";

const ICONS_MOD = "@/components/ui/icons";
const ANIM_MOD = "@/components/ui/icons/animated";

const REFACTOR = {
  "apps/pos-desktop/src/domain/fiscal/fiscal.page.tsx": {
    icons: ["XIcon"],
    blocks: ['<XIcon size={20} />'],
  },
  "apps/pos-desktop/src/renderer/components/assistant/palette-search-input.tsx": {
    icons: ["SearchIcon"],
    animated: ["LoaderIcon"],
    blocks: [
      '<LoaderIcon className="h-3.5 w-3.5" style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }} />',
    ],
  },
  "apps/pos-desktop/src/renderer/components/assistant/palette-states.tsx": {
    icons: [],
    animated: ["LoaderIcon"],
    blocks: [
      '<LoaderIcon className="mb-3 h-6 w-6" style={{ color: "color-mix(in srgb, var(--color-ink) 40%, transparent)" }} />',
    ],
  },
  "apps/pos-desktop/src/renderer/components/auth/login-header.tsx": {
    icons: ["LogoIcon"],
    blocks: ['<LogoIcon size={36} />'],
  },
  "apps/pos-desktop/src/renderer/components/auth/login.page.tsx": {
    icons: ["WifiIcon"],
    blocks: ['<WifiIcon size={14} strokeWidth={1.2} className="shrink-0" />'],
  },
  "apps/pos-desktop/src/renderer/components/auth/offline/offline-mode-banner.tsx": {
    icons: ["WifiOffIcon", "XIcon"],
    blocks: [
      '<WifiOffIcon size={16} strokeWidth={1.2} />',
      '<XIcon size={14} strokeWidth={1.5} />',
    ],
  },
  "apps/pos-desktop/src/renderer/components/auth/offline/pending-blessing-modal.tsx": {
    icons: ["XIcon"],
    blocks: ['<XIcon size={14} strokeWidth={1.5} />'],
  },
  "apps/pos-desktop/src/renderer/components/auth/quick-switch.component.tsx": {
    icons: ["ChevronDownIcon"],
    blocks: [
      "<ChevronDownIcon size={12} style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s', color: 'var(--color-ink-muted)' }} />",
    ],
  },
  "apps/pos-desktop/src/renderer/components/auth/sessions/session-view.tsx": {
    icons: ["ChevronLeftIcon"],
    blocks: ['<ChevronLeftIcon size={20} strokeWidth={1.5} />'],
  },
  "apps/pos-desktop/src/renderer/components/auth/user-table.tsx": {
    icons: ["ChevronDownIcon"],
    blocks: [
      '<ChevronDownIcon className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />',
      '<ChevronDownIcon className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />',
    ],
  },
  "apps/pos-desktop/src/renderer/components/config/config-history.section.tsx": {
    icons: ["ClockIcon"],
    animated: ["LoaderIcon"],
    blocks: ['<LoaderIcon className="h-6 w-6 text-ink-muted" />'],
  },
  "apps/pos-desktop/src/renderer/components/config/named-presets.section.tsx": {
    icons: ["CheckIcon", "PlusIcon", "Trash2Icon"],
    animated: ["LoaderIcon"],
    blocks: ['<LoaderIcon className="h-6 w-6 text-ink-muted" />'],
  },
  "apps/pos-desktop/src/renderer/components/config/preset-card.tsx": {
    icons: ["CheckCircleIcon", "ClockIcon", "LockIcon", "SettingsIcon"],
    blocks: [
      '<CheckCircleIcon size={20} className="text-pharma" />',
      '<ClockIcon size={20} className="text-urgency" />',
      '<LockIcon size={20} className="text-error" />',
      '<SettingsIcon size={20} className="text-restrict" />',
    ],
  },
  "apps/pos-desktop/src/renderer/components/config/tenant-config.page.tsx": {
    icons: [],
    animated: ["LoaderIcon"],
    blocks: ['<LoaderIcon className="h-8 w-8 text-ink-muted" />'],
  },
  "apps/pos-desktop/src/renderer/components/local-sync/local-network.page.tsx": {
    icons: [],
    animated: ["LoaderIcon"],
    blocks: ['<LoaderIcon className="h-4 w-4" />'],
  },
  "apps/pos-desktop/src/renderer/components/PaymentProcessing/payment-status-badge.tsx": {
    icons: ["CheckIcon", "XIcon"],
    animated: ["LoaderIcon"],
    blocks: [
      '<LoaderIcon className="h-3.5 w-3.5" />',
      '<CheckIcon className="h-3.5 w-3.5" strokeWidth={3} />',
      '<XIcon className="h-3.5 w-3.5" strokeWidth={3} />',
    ],
  },
  "apps/pos-desktop/src/renderer/components/printing/print-job-row.tsx": {
    icons: ["ChevronRightIcon", "XIcon"],
    blocks: [
      '<ChevronRightIcon size={12} className={`transition-transform ${logExpanded ? \'rotate-90\' : \'\'}`} />',
      '<XIcon size={16} />',
    ],
  },
  "apps/pos-desktop/src/renderer/components/printing/printer-card.tsx": {
    icons: ["ClockIcon", "XIcon"],
    blocks: [
      '<ClockIcon size={12} />',
      '<XIcon size={16} />',
    ],
  },
  "apps/pos-desktop/src/renderer/components/printing/setup-wizard-step-discovery.tsx": {
    icons: ["PrinterIcon", "PlugIcon", "MicIcon", "CirclePlusIcon", "CheckIcon"],
    blocks: [
      '<PrinterIcon size={28} strokeWidth={1.5} className="text-pharma" />',
      '<PlugIcon size={16} strokeWidth={1.5} className="text-ink-muted" />',
      '<MicIcon size={16} strokeWidth={1.5} className="text-ink-muted" />',
      '<CirclePlusIcon size={16} strokeWidth={1.5} className="text-ink-muted" />',
      '<CheckIcon size={14} className="text-white" />',
    ],
  },
  "apps/pos-desktop/src/renderer/components/printing/setup-wizard-step-found-printers.tsx": {
    icons: ["CheckIcon", "ChevronDownIcon", "HelpCircleIcon", "AlertTriangleIcon", "AlertCircleIcon"],
    blocks: [
      '<CheckIcon className="h-3 w-3 text-white" />',
      '<ChevronDownIcon className="pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-ink-muted" />',
      "<CheckIcon className=\"h-3 w-3 shrink-0 text-success\" aria-label={t( 'printing.wizard.found_printers.confidence_high', 'Detección precisa', )} />",
      "<HelpCircleIcon className=\"h-3 w-3 shrink-0 text-urgency\" aria-label={t( 'printing.wizard.found_printers.confidence_low', 'Detección incierta', )} />",
      "<AlertTriangleIcon className=\"h-3 w-3 shrink-0 text-error\" aria-label={t( 'printing.wizard.found_printers.confidence_none', 'No detectado', )} />",
      '<AlertCircleIcon size={32} className="mx-auto mb-3 text-urgency" />',
    ],
  },
  "apps/pos-desktop/src/renderer/components/printing/setup-wizard-step-job-assignment.tsx": {
    icons: ["ChevronDownIcon", "CheckIcon", "HelpCircleIcon", "AlertTriangleIcon"],
    blocks: [
      '<ChevronDownIcon className="pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-ink-muted" />',
      "<CheckIcon className=\"h-3 w-3 shrink-0 text-success\" aria-label={t( 'printing.wizard.job_assignment.confidence_high', 'Detección precisa', )} />",
      "<HelpCircleIcon className=\"h-3 w-3 shrink-0 text-urgency\" aria-label={t( 'printing.wizard.job_assignment.confidence_low', 'Detección incierta', )} />",
      "<AlertTriangleIcon className=\"h-3 w-3 shrink-0 text-error\" aria-label={t( 'printing.wizard.job_assignment.confidence_none', 'No detectado', )} />",
    ],
  },
  "apps/pos-desktop/src/renderer/components/printing/setup-wizard-step-summary.tsx": {
    icons: ["BookIcon"],
    blocks: ['<BookIcon size={12} />'],
  },
  "apps/pos-desktop/src/renderer/components/printing/setup-wizard-step-test-prints.tsx": {
    icons: ["FileTextIcon"],
    blocks: ['<FileTextIcon size={12} />'],
  },
  "apps/pos-desktop/src/renderer/components/products/product-form.tsx": {
    icons: ["XIcon"],
    blocks: ['<XIcon size={14} color="#D32F2F" />'],
  },
  "apps/pos-desktop/src/renderer/components/Receipt/receipt.tsx": {
    icons: ["CheckIcon", "PrinterIcon"],
    blocks: [
      '<CheckIcon className="h-5 w-5" color="var(--color-pharma)" strokeWidth={2.5} />',
      '<PrinterIcon className="mr-2 inline h-4 w-4" />',
    ],
  },
  "apps/pos-desktop/src/renderer/components/returns/unverified-return-flow.tsx": {
    icons: ["Trash2Icon"],
    blocks: ['<Trash2Icon size={16} />'],
  },
  "apps/pos-desktop/src/renderer/components/SalesTransaction/cart-panel.tsx": {
    icons: ["InfoIcon", "ShoppingBagIcon"],
    blocks: [
      '<InfoIcon size={16} className="mt-0.5 shrink-0" />',
      '<ShoppingBagIcon size={18} />',
    ],
  },
  "apps/pos-desktop/src/renderer/components/SalesTransaction/client-selector.tsx": {
    icons: ["UserIcon", "XIcon", "SearchIcon", "PlusIcon"],
    blocks: [
      '<UserIcon size={16} className="shrink-0" style={{ color: "var(--color-pharma)" }} />',
      '<XIcon size={14} />',
      '<SearchIcon size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "color-mix(in srgb, var(--color-ink) 40%, transparent)" }} />',
      '<PlusIcon size={15} />',
      '<UserIcon size={14} className="shrink-0" style={{ color: "color-mix(in srgb, var(--color-ink) 40%, transparent)" }} />',
      '<PlusIcon size={14} />',
      '<UserIcon size={14} />',
    ],
  },
  "apps/pos-desktop/src/renderer/components/SalesTransaction/help-bar.tsx": {
    icons: ["CommandIcon", "HelpCircleIcon", "EnterIcon"],
    blocks: [
      '<CommandIcon size={12} />',
      '<HelpCircleIcon size={12} />',
      '<EnterIcon size={12} />',
    ],
  },
  "apps/pos-desktop/src/renderer/components/SalesTransaction/product-search.tsx": {
    icons: ["SearchIcon"],
    blocks: [
      '<SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "color-mix(in srgb, var(--color-ink) 35%, transparent)" }} />',
    ],
  },
  "apps/pos-desktop/src/renderer/components/SalesTransaction/quick-client-form.tsx": {
    icons: ["InfoIcon"],
    animated: ["LoaderIcon"],
    blocks: [
      '<InfoIcon size={12} />',
      '<LoaderIcon className="size-3.5" />',
    ],
  },
  "apps/pos-desktop/src/renderer/components/sync/auth-status-badge.tsx": {
    icons: ["CheckCircleIcon", "RefreshCwIcon", "RepeatIcon", "XCircleIcon", "UserCircleIcon"],
    animated: ["LoaderIcon"],
    blocks: [
      '<LoaderIcon className="h-3.5 w-3.5" />',
      '<CheckCircleIcon className="h-3.5 w-3.5" />',
      '<RefreshCwIcon className="h-3.5 w-3.5" />',
      '<RepeatIcon className="h-3.5 w-3.5" />',
      '<XCircleIcon className="h-3.5 w-3.5" />',
      '<UserCircleIcon className="h-3.5 w-3.5" />',
    ],
  },
  "apps/pos-desktop/src/renderer/components/sync/sync-health-loading.tsx": {
    icons: [],
    animated: ["LoaderIcon"],
    blocks: ['<LoaderIcon className="h-10 w-10 text-gray-400" />'],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mergeImport(content, modulePath, names) {
  const re = new RegExp(
    'import\\s*\\{([^}]*)\\}\\s*from\\s*["\']' +
      modulePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      '["\'];?',
    "g",
  );
  const matches = [...content.matchAll(re)];
  const existing = new Set();
  for (const m of matches) {
    for (const part of m[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "");
      if (name) existing.add(name);
    }
  }
  for (const n of names) existing.add(n);
  if (existing.size === 0) return content;

  const sorted = [...existing].sort();
  const line = `import { ${sorted.join(", ")} } from "${modulePath}";`;

  if (matches.length > 0) {
    // Replace first match with merged line, drop the rest.
    const first = matches[0];
    const { index } = first;
    const afterFirst = index + first[0].length;
    let tail = content.slice(afterFirst);
    // Remove the remaining matches in reverse order.
    for (let i = matches.length - 1; i >= 1; i--) {
      const m = matches[i];
      // Only remove if it is inside the tail (relative to first match).
      const relStart = m.index - afterFirst;
      if (relStart >= 0) {
        tail = tail.slice(0, relStart) + tail.slice(relStart + m[0].length);
      }
    }
    return content.slice(0, index) + line + "\n" + tail;
  }

  // No existing import: insert after the last import statement.
  const importLines = [...content.matchAll(/^import\s/mg)];
  if (importLines.length > 0) {
    const last = importLines[importLines.length - 1];
    const lineEnd = content.indexOf("\n", last.index);
    const insertAt = lineEnd === -1 ? content.length : lineEnd + 1;
    return content.slice(0, insertAt) + line + "\n" + content.slice(insertAt);
  }
  return line + "\n" + content;
}

let changed = 0;
for (const [file, cfg] of Object.entries(REFACTOR)) {
  let content = readFileSync(file, "utf8");
  const svgRe = /<svg[\s\S]*?<\/svg>/g;
  const blocks = [...content.matchAll(svgRe)];
  if (blocks.length !== cfg.blocks.length) {
    console.error(`MISMATCH ${file}: found ${blocks.length} svg, expected ${cfg.blocks.length}`);
    continue;
  }
  // Replace in reverse order so indices stay valid.
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    content = content.slice(0, b.index) + cfg.blocks[i] + content.slice(b.index + b[0].length);
  }
  if (cfg.icons && cfg.icons.length > 0) {
    content = mergeImport(content, ICONS_MOD, cfg.icons);
  }
  if (cfg.animated && cfg.animated.length > 0) {
    content = mergeImport(content, ANIM_MOD, cfg.animated);
  }
  writeFileSync(file, content);
  changed++;
  console.log(`OK ${file}`);
}
console.log(`\nDone. ${changed}/${Object.keys(REFACTOR).length} files refactored.`);
