/**
 * Pure markdown → React renderer for in-app help content.
 *
 * Extracted from the monolithic help-viewer.tsx so the rendering logic can be
 * unit-tested without rendering the full help dialog tree.
 *
 * Supports a safe subset of Markdown:
 *   - Inline: **bold**, *italic*, `code`, [text](url)
 *   - Block: headings (#/##/###), fenced code blocks (```), tables (|...|),
 *     blockquotes/callouts (>), unordered lists (-), ordered lists (1.),
 *     paragraphs
 */

import {
  type ReactNode,
  Children,
  cloneElement,
  isValidElement,
} from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InlineSegment {
  type: 'text' | 'strong' | 'em' | 'code' | 'link';
  content: string;
  href?: string;
}

// ---------------------------------------------------------------------------
// Inline renderer
// ---------------------------------------------------------------------------

/**
 * Parse a line of text into inline segments.
 * Handles **bold**, *italic*, `code`, and [text](url).
 */
export function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const regex =
    /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)|(\[(.+?)\]\((.+?)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Plain text before this match
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        content: text.slice(lastIndex, match.index),
      });
    }

    if (match[1]) {
      segments.push({ type: 'strong', content: match[2]! });
    } else if (match[3]) {
      segments.push({ type: 'em', content: match[4]! });
    } else if (match[5]) {
      segments.push({ type: 'code', content: match[6]! });
    } else if (match[7]) {
      segments.push({ type: 'link', content: match[8]!, href: match[9]! });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return segments;
}

/**
 * Render inline segments into an array of React nodes.
 * Each segment receives a stable key based on its position.
 */
export function renderInline(
  segments: InlineSegment[],
  baseKey: string,
): ReactNode {
  return segments.map((seg, i) => {
    const key = `${baseKey}-${i}`;
    switch (seg.type) {
      case 'strong':
        return <strong key={key}>{seg.content}</strong>;
      case 'em':
        return <em key={key}>{seg.content}</em>;
      case 'code':
        return (
          <code
            key={key}
            className="rounded-pos bg-[color-mix(in_srgb,var(--color-ink)_8%,transparent)] px-1 py-0.5 font-data text-caption tabular-nums"
          >
            {seg.content}
          </code>
        );
      case 'link':
        return (
          <a
            key={key}
            href={seg.href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 decoration-[color-mix(in_srgb,var(--color-pharma)_50%,transparent)] hover:decoration-[var(--color-pharma)] transition-colors"
            style={{ color: 'var(--color-pharma)' }}
          >
            {seg.content}
          </a>
        );
      case 'text':
      default:
        return <span key={key}>{seg.content}</span>;
    }
  });
}

// ---------------------------------------------------------------------------
// Block-level renderer
// ---------------------------------------------------------------------------

/**
 * Render the full Markdown body as an array of React block elements.
 */
export function renderMarkdown(body: string): ReactNode[] {
  const lines = body.split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // ── Fenced code block ──────────────────────────────────────────────
    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) {
        codeLines.push(lines[i]!);
        i++;
      }
      i++; // skip closing ```
      blocks.push(
        <pre
          key={`block-${blocks.length}`}
          className="overflow-x-auto rounded-pos border p-3 text-caption leading-relaxed"
          style={{
            backgroundColor:
              'color-mix(in srgb, var(--color-ink) 4%, var(--color-surface))',
            borderColor:
              'color-mix(in srgb, var(--color-ink) 10%, transparent)',
            color: 'var(--color-ink)',
          }}
        >
          <code className="font-data tabular-nums">{codeLines.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // ── Table ──────────────────────────────────────────────────────────
    if (line.startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('|')) {
        tableLines.push(lines[i]!);
        i++;
      }
      blocks.push(renderTable(tableLines, blocks.length));
      continue;
    }

    // ── Heading ────────────────────────────────────────────────────────
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1]!.length;
      const text = headingMatch[2]!;
      const Tag = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';
      blocks.push(
        <Tag
          key={`block-${blocks.length}`}
          className={
            level === 1
              ? 'mb-3 mt-0 text-heading font-bold'
              : level === 2
                ? 'mb-2 mt-6 text-ui font-semibold'
                : 'mb-1 mt-4 text-body font-semibold'
          }
          style={{ color: 'var(--color-ink)' }}
        >
          {renderInline(parseInline(text), `h-${blocks.length}`)}
        </Tag>,
      );
      i++;
      continue;
    }

    // ── Blockquote / callout ───────────────────────────────────────────
    if (line.startsWith('>')) {
      const quoteLines: string[] = [line.replace(/^>\s?/, '')];
      i++;
      while (i < lines.length && lines[i]!.startsWith('>')) {
        quoteLines.push(lines[i]!.replace(/^>\s?/, ''));
        i++;
      }
      const quoteText = quoteLines.join('\n');
      const isWarning =
        quoteText.includes('\u26A0\uFE0F') ||
        quoteText.toLowerCase().includes('alerta') ||
        quoteText.toLowerCase().includes('warning') ||
        quoteText.toLowerCase().includes('importante') ||
        quoteText.toLowerCase().includes('cuidado');
      blocks.push(
        <blockquote
          key={`block-${blocks.length}`}
          className="my-3 rounded-pos border-l-4 px-3 py-2 text-body-sm leading-relaxed"
          style={{
            borderLeftColor: isWarning
              ? 'var(--color-urgency)'
              : 'var(--color-pharma)',
            backgroundColor: isWarning
              ? 'var(--color-urgency-surface)'
              : 'color-mix(in srgb, var(--color-pharma) 5%, var(--color-panel))',
            color: 'var(--color-ink)',
          }}
        >
          {renderInline(parseInline(quoteText), `bq-${blocks.length}`)}
        </blockquote>,
      );
      continue;
    }

    // ── Unordered list ─────────────────────────────────────────────────
    if (line.match(/^[-*]\s+/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i]!.match(/^[-*]\s+/)) {
        items.push(lines[i]!.replace(/^[-*]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul
          key={`block-${blocks.length}`}
          className="my-2 list-disc pl-6 text-body leading-relaxed"
          style={{ color: 'var(--color-ink)' }}
        >
          {items.map((item, idx) => (
            <li key={`li-${blocks.length}-${idx}`} className="mb-1">
              {renderInline(parseInline(item), `li-${blocks.length}-${idx}`)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // ── Ordered list ───────────────────────────────────────────────────
    if (line.match(/^\d+\.\s+/)) {
      const items: string[] = [];
      const startNumber = parseInt(
        line.match(/^(\d+)\./)?.[1] ?? '1',
        10,
      );
      while (i < lines.length && lines[i]!.match(/^\d+\.\s+/)) {
        items.push(lines[i]!.replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push(
        <ol
          key={`block-${blocks.length}`}
          start={startNumber}
          className="my-2 list-decimal pl-6 text-body leading-relaxed"
          style={{ color: 'var(--color-ink)' }}
        >
          {items.map((item, idx) => (
            <li key={`oli-${blocks.length}-${idx}`} className="mb-1">
              {renderInline(
                parseInline(item),
                `oli-${blocks.length}-${idx}`,
              )}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    // ── Empty line ─────────────────────────────────────────────────────
    if (line.trim() === '') {
      i++;
      continue;
    }

    // ── Paragraph (default) ────────────────────────────────────────────
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !lines[i]!.startsWith('#') &&
      !lines[i]!.startsWith('```') &&
      !lines[i]!.startsWith('>') &&
      !lines[i]!.startsWith('|') &&
      !lines[i]!.match(/^[-*\d]/)
    ) {
      paraLines.push(lines[i]!);
      i++;
    }
    blocks.push(
      <p
        key={`block-${blocks.length}`}
        className="my-2 text-body leading-relaxed"
        style={{ color: 'var(--color-ink)' }}
      >
        {renderInline(
          parseInline(paraLines.join(' ')),
          `p-${blocks.length}`,
        )}
      </p>,
    );
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Table renderer
// ---------------------------------------------------------------------------

/** Parse a set of consecutive `|` lines into an HTML table. */
export function renderTable(
  lines: string[],
  blockIndex: number,
): ReactNode {
  // Remove leading/trailing pipes and split cells
  const rows = lines
    .filter((l) => l.trim().startsWith('|'))
    .map((l) =>
      l
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim()),
    );

  // Determine if there's a separator row (second row with dashes)
  const hasSeparator =
    rows.length > 1 &&
    rows[1]!.every((cell) => /^:?-+:?$/.test(cell.replace(/\s/g, '')));

  const headerRows = hasSeparator
    ? rows.slice(0, 1)
    : rows.length > 0
      ? [rows[0]!]
      : [];
  const bodyRows = hasSeparator ? rows.slice(2) : rows.slice(1);
  const colCount = headerRows[0]?.length ?? bodyRows[0]?.length ?? 1;

  return (
    <div key={`block-${blockIndex}`} className="my-3 overflow-x-auto">
      <table
        className="w-full border-collapse text-body-sm leading-relaxed"
        style={{ color: 'var(--color-ink)' }}
      >
        {headerRows.length > 0 && (
          <thead>
            <tr>
              {headerRows[0]!.map((cell, ci) => (
                <th
                  key={`th-${blockIndex}-${ci}`}
                  className="border px-3 py-1.5 text-left text-caption font-semibold uppercase tracking-wider"
                  style={{
                    borderColor:
                      'color-mix(in srgb, var(--color-ink) 15%, transparent)',
                    backgroundColor:
                      'color-mix(in srgb, var(--color-surface) 60%, white)',
                    color:
                      'color-mix(in srgb, var(--color-ink) 60%, transparent)',
                  }}
                >
                  {renderInline(
                    parseInline(cell),
                    `th-${blockIndex}-${ci}`,
                  )}
                </th>
              ))}
              {Array.from({
                length: Math.max(0, colCount - headerRows[0]!.length),
              }).map((_, ci) => (
                <th
                  key={`th-${blockIndex}-fill-${ci}`}
                  className="border px-3 py-1.5"
                  style={{
                    borderColor:
                      'color-mix(in srgb, var(--color-ink) 15%, transparent)',
                  }}
                />
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {bodyRows.map((row, ri) => (
            <tr key={`tr-${blockIndex}-${ri}`}>
              {row.map((cell, ci) => (
                <td
                  key={`td-${blockIndex}-${ri}-${ci}`}
                  className="border px-3 py-1.5"
                  style={{
                    borderColor:
                      'color-mix(in srgb, var(--color-ink) 10%, transparent)',
                  }}
                >
                  {renderInline(
                    parseInline(cell),
                    `td-${blockIndex}-${ri}-${ci}`,
                  )}
                </td>
              ))}
              {Array.from({
                length: Math.max(0, colCount - row.length),
              }).map((_, ci) => (
                <td
                  key={`td-${blockIndex}-${ri}-fill-${ci}`}
                  className="border px-3 py-1.5"
                  style={{
                    borderColor:
                      'color-mix(in srgb, var(--color-ink) 10%, transparent)',
                  }}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
