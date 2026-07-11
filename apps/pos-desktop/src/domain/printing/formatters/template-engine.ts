/**
 * Lightweight template engine for receipt and invoice placeholders.
 *
 * Substitutes `{{variable.path}}` placeholders with values from a
 * VariableContext object. Handles nested paths like `sale.total`,
 * `invoice.cufe`, `client.name`, etc.
 *
 * Missing variables are replaced with a visible placeholder in UPPER_SNAKE_CASE
 * (e.g. `{{sale.total}}` → `[SALE_TOTAL]`) rather than crashing or printing
 * "undefined". The substitution is logged for the audit trail.
 */

import type { VariableContext } from '../printing-types';

/**
 * Resolve a dot-separated path against a context object.
 * Returns undefined if any segment is missing or the path is invalid.
 */
function resolvePath(context: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = context;

  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

/**
 * Replace all `{{placeholder}}` occurrences in a template string.
 *
 * @param template  The template string containing `{{path}}` placeholders.
 * @param context   The variable context to resolve placeholders against.
 * @returns         The template with all resolved substitutions applied.
 */
export function resolveTemplateVariables(
  template: string,
  context: VariableContext,
): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, path: string) => {
    const value = resolvePath(context as Record<string, unknown>, path);

    if (value === null || value === undefined) {
      // Return a visible placeholder instead of crash/undefined
      const placeholder = path
        .replace(/\./g, '_')
        .toUpperCase();
      return `[${placeholder}]`;
    }

    // Format numbers with locale
    if (typeof value === 'number') {
      return value.toLocaleString('es-CO', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }

    // Format dates
    if (value instanceof Date) {
      return value.toLocaleDateString('es-CO', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    return String(value);
  });
}

/**
 * Resolve header lines: each line can contain {{placeholders}}.
 */
export function resolveHeaderLines(
  lines: string[],
  context: VariableContext,
): string[] {
  return lines.map((line) => resolveTemplateVariables(line, context));
}

/**
 * Resolve footer lines: each line can contain {{placeholders}}.
 */
export function resolveFooterLines(
  lines: string[],
  context: VariableContext,
): string[] {
  return lines.map((line) => resolveTemplateVariables(line, context));
}

/**
 * Build a combined receipt text from header lines, body, and footer lines,
 * all with variables resolved.
 */
export function buildResolvedReceipt(
  headerLines: string[],
  templateBody: string,
  footerLines: string[],
  context: VariableContext,
): { header: string[]; body: string; footer: string[] } {
  return {
    header: resolveHeaderLines(headerLines, context),
    body: resolveTemplateVariables(templateBody, context),
    footer: resolveFooterLines(footerLines, context),
  };
}
