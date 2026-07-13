/**
 * Help viewer — full-screen overlay for bundled Markdown help content.
 *
 * Opened from F1 (context help), the command palette, or an error toast with a
 * help link. Provides a searchable index sidebar and renders Markdown topics
 * with clean domain-grounded typography.
 *
 * Two modes:
 *   - Index mode (default): grouped topic list in the sidebar, welcome/home
 *     content in the right pane.
 *   - Topic mode: selected topic rendered as styled Markdown in the right pane.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import {
  Children,
  type FC,
  type KeyboardEvent as ReactKeyboardEvent,
  cloneElement,
  isValidElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { HelpContentEntry } from "../../../help-content";
import {
  getAllHelpEntries,
  getHelpEntry,
  searchHelpEntries,
} from "../../../help-content";
import { useAssistantStore } from "../../../stores/assistant.store";
import { useUserPreferencesStore } from "../../../stores/user-preferences.store";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;
type EntrySection = "screens" | "procedures" | "general";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Determine which section a help entry belongs to based on its file path. */
function getEntrySection(entry: HelpContentEntry): EntrySection {
  if (entry.path.includes("/screens/")) return "screens";
  if (entry.path.includes("/procedures/")) return "procedures";
  return "general";
}

/** Format an ISO date string to a locale-friendly short date. */
function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-CO", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

/** Check whether a date string is older than six months. */
function isOlderThanSixMonths(iso: string): boolean {
  try {
    return Date.now() - new Date(iso).getTime() > SIX_MONTHS_MS;
  } catch {
    return false;
  }
}

/** Group an array of entries by section, preserving a stable order. */
function groupBySection(
  entries: HelpContentEntry[],
): { section: EntrySection; entries: HelpContentEntry[] }[] {
  const map = new Map<EntrySection, HelpContentEntry[]>();
  for (const entry of entries) {
    const section = getEntrySection(entry);
    const list = map.get(section);
    if (list) {
      list.push(entry);
    } else {
      map.set(section, [entry]);
    }
  }
  const order: EntrySection[] = ["screens", "procedures", "general"];
  const result: { section: EntrySection; entries: HelpContentEntry[] }[] = [];
  for (const section of order) {
    const items = map.get(section);
    if (items && items.length > 0) {
      result.push({ section, entries: items });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Section label helper
// ---------------------------------------------------------------------------

function sectionLabelKey(section: EntrySection): string {
  switch (section) {
    case "screens":
      return "assistant.help.screens";
    case "procedures":
      return "assistant.help.procedures";
    case "general":
      return "assistant.help.general";
  }
}

// ---------------------------------------------------------------------------
// Inline markdown renderer (text → React nodes)
// ---------------------------------------------------------------------------

interface InlineSegment {
  type: "text" | "strong" | "em" | "code" | "link";
  content: string;
  href?: string;
}

/**
 * Parse a line of text into inline segments.
 * Handles **bold**, *italic*, `code`, and [text](url).
 */
function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const regex =
    /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)|(\[(.+?)\]\((.+?)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Plain text before this match
    if (match.index > lastIndex) {
      segments.push({
        type: "text",
        content: text.slice(lastIndex, match.index),
      });
    }

    if (match[1]) {
      // **bold**
      segments.push({ type: "strong", content: match[2]! });
    } else if (match[3]) {
      // *italic*
      segments.push({ type: "em", content: match[4]! });
    } else if (match[5]) {
      // `code`
      segments.push({ type: "code", content: match[6]! });
    } else if (match[7]) {
      // [text](url)
      segments.push({ type: "link", content: match[8]!, href: match[9]! });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }

  return segments;
}

/**
 * Render inline segments into an array of React nodes.
 * Each segment receives a stable key based on its position.
 */
function renderInline(segments: InlineSegment[], baseKey: string): ReactNode {
  return segments.map((seg, i) => {
    const key = `${baseKey}-${i}`;
    switch (seg.type) {
      case "strong":
        return <strong key={key}>{seg.content}</strong>;
      case "em":
        return <em key={key}>{seg.content}</em>;
      case "code":
        return (
          <code
            key={key}
            className="rounded-pos bg-[color-mix(in_srgb,var(--color-ink)_8%,transparent)] px-1 py-0.5 font-data text-caption tabular-nums"
          >
            {seg.content}
          </code>
        );
      case "link":
        return (
          <a
            key={key}
            href={seg.href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 decoration-[color-mix(in_srgb,var(--color-pharma)_50%,transparent)] hover:decoration-[var(--color-pharma)] transition-colors"
            style={{ color: "var(--color-pharma)" }}
          >
            {seg.content}
          </a>
        );
      case "text":
      default:
        return <span key={key}>{seg.content}</span>;
    }
  });
}

// ---------------------------------------------------------------------------
// Block-level markdown renderer (raw string → React nodes)
// ---------------------------------------------------------------------------

/**
 * Render the full Markdown body as an array of React block elements.
 *
 * Block types handled:
 *   - headings (# / ## / ###)
 *   - fenced code blocks (```)
 *   - tables (| ... |)
 *   - blockquotes / callouts (> ...)
 *   - unordered lists (- item)
 *   - ordered lists (1. item)
 *   - paragraphs
 */
function renderMarkdown(body: string): ReactNode[] {
  const lines = body.split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // ── Fenced code block ──────────────────────────────────────────────
    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        codeLines.push(lines[i]!);
        i++;
      }
      i++; // skip closing ```
      blocks.push(
        <pre
          key={`block-${blocks.length}`}
          className="overflow-x-auto rounded-pos border p-3 text-caption leading-relaxed"
          style={{
            backgroundColor: "color-mix(in srgb, var(--color-ink) 4%, var(--color-surface))",
            borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)",
            color: "var(--color-ink)",
          }}
        >
          <code className="font-data tabular-nums">{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // ── Table ──────────────────────────────────────────────────────────
    if (line.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("|")) {
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
      const Tag = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
      blocks.push(
        <Tag
          key={`block-${blocks.length}`}
          className={level === 1 ? "mb-3 mt-0 text-heading font-bold" : level === 2 ? "mb-2 mt-6 text-ui font-semibold" : "mb-1 mt-4 text-body font-semibold"}
          style={{ color: "var(--color-ink)" }}
        >
          {renderInline(parseInline(text), `h-${blocks.length}`)}
        </Tag>,
      );
      i++;
      continue;
    }

    // ── Blockquote / callout ───────────────────────────────────────────
    if (line.startsWith(">")) {
      const quoteLines: string[] = [line.replace(/^>\s?/, "")];
      i++;
      while (i < lines.length && lines[i]!.startsWith(">")) {
        quoteLines.push(lines[i]!.replace(/^>\s?/, ""));
        i++;
      }
      const quoteText = quoteLines.join("\n");
      const isWarning =
        quoteText.includes("⚠️") ||
        quoteText.toLowerCase().includes("alerta") ||
        quoteText.toLowerCase().includes("warning") ||
        quoteText.toLowerCase().includes("importante") ||
        quoteText.toLowerCase().includes("cuidado");
      blocks.push(
        <blockquote
          key={`block-${blocks.length}`}
          className="my-3 rounded-pos border-l-4 px-3 py-2 text-body-sm leading-relaxed"
          style={{
            borderLeftColor: isWarning ? "var(--color-urgency)" : "var(--color-pharma)",
            backgroundColor: isWarning
              ? "var(--color-urgency-surface)"
              : "color-mix(in srgb, var(--color-pharma) 5%, var(--color-panel))",
            color: "var(--color-ink)",
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
        items.push(lines[i]!.replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul
          key={`block-${blocks.length}`}
          className="my-2 list-disc pl-6 text-body leading-relaxed"
          style={{ color: "var(--color-ink)" }}
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
      const startNumber = parseInt(line.match(/^(\d+)\./)?.[1] ?? "1", 10);
      while (i < lines.length && lines[i]!.match(/^\d+\.\s+/)) {
        items.push(lines[i]!.replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol
          key={`block-${blocks.length}`}
          start={startNumber}
          className="my-2 list-decimal pl-6 text-body leading-relaxed"
          style={{ color: "var(--color-ink)" }}
        >
          {items.map((item, idx) => (
            <li key={`oli-${blocks.length}-${idx}`} className="mb-1">
              {renderInline(parseInline(item), `oli-${blocks.length}-${idx}`)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    // ── Empty line ─────────────────────────────────────────────────────
    if (line.trim() === "") {
      i++;
      continue;
    }

    // ── Paragraph (default) ────────────────────────────────────────────
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !lines[i]!.startsWith("#") &&
      !lines[i]!.startsWith("```") &&
      !lines[i]!.startsWith(">") &&
      !lines[i]!.startsWith("|") &&
      !lines[i]!.match(/^[-*\d]/)
    ) {
      paraLines.push(lines[i]!);
      i++;
    }
    blocks.push(
      <p
        key={`block-${blocks.length}`}
        className="my-2 text-body leading-relaxed"
        style={{ color: "var(--color-ink)" }}
      >
        {renderInline(parseInline(paraLines.join(" ")), `p-${blocks.length}`)}
      </p>,
    );
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Table renderer
// ---------------------------------------------------------------------------

/** Parse a set of consecutive `|` lines into an HTML table. */
function renderTable(lines: string[], blockIndex: number): ReactNode {
  // Remove leading/trailing pipes and split cells
  const rows = lines
    .filter((l) => l.trim().startsWith("|"))
    .map((l) =>
      l
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((c) => c.trim()),
    );

  // Determine if there's a separator row (second row with dashes)
  const hasSeparator =
    rows.length > 1 &&
    rows[1]!.every((cell) => /^:?-+:?$/.test(cell.replace(/\s/g, "")));

  const headerRows = hasSeparator ? rows.slice(0, 1) : rows.length > 0 ? [rows[0]!] : [];
  const bodyRows = hasSeparator ? rows.slice(2) : rows.slice(1);
  const colCount = headerRows[0]?.length ?? bodyRows[0]?.length ?? 1;

  return (
    <div
      key={`block-${blockIndex}`}
      className="my-3 overflow-x-auto"
    >
      <table
        className="w-full border-collapse text-body-sm leading-relaxed"
        style={{ color: "var(--color-ink)" }}
      >
        {headerRows.length > 0 && (
          <thead>
            <tr>
              {headerRows[0]!.map((cell, ci) => (
                <th
                  key={`th-${blockIndex}-${ci}`}
                  className="border px-3 py-1.5 text-left text-caption font-semibold uppercase tracking-wider"
                  style={{
                    borderColor: "color-mix(in srgb, var(--color-ink) 15%, transparent)",
                    backgroundColor: "color-mix(in srgb, var(--color-surface) 60%, white)",
                    color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
                  }}
                >
                  {renderInline(parseInline(cell), `th-${blockIndex}-${ci}`)}
                </th>
              ))}
              {/* Fill missing header cells */}
              {Array.from({ length: Math.max(0, colCount - headerRows[0]!.length) }).map(
                (_, ci) => (
                  <th
                    key={`th-${blockIndex}-fill-${ci}`}
                    className="border px-3 py-1.5"
                    style={{
                      borderColor: "color-mix(in srgb, var(--color-ink) 15%, transparent)",
                    }}
                  />
                ),
              )}
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
                    borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)",
                  }}
                >
                  {renderInline(parseInline(cell), `td-${blockIndex}-${ri}-${ci}`)}
                </td>
              ))}
              {/* Fill missing body cells */}
              {Array.from({ length: Math.max(0, colCount - row.length) }).map(
                (_, ci) => (
                  <td
                    key={`td-${blockIndex}-${ri}-fill-${ci}`}
                    className="border px-3 py-1.5"
                    style={{
                      borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)",
                    }}
                  />
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HelpViewer component
// ---------------------------------------------------------------------------

export const HelpViewer: FC = () => {
  const { t } = useTranslation();

  // ---- Store ----
  const helpOpen = useAssistantStore((s) => s.helpOpen);
  const helpTopicId = useAssistantStore((s) => s.helpTopicId);
  const closeHelp = useAssistantStore((s) => s.closeHelp);

  const recordHelpPageView = useUserPreferencesStore((s) => s.recordHelpPageView);
  const wasHelpPageViewedRecently = useUserPreferencesStore(
    (s) => s.wasHelpPageViewedRecently,
  );

  // ---- Local state ----
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [checkedSteps, setCheckedSteps] = useState<Set<number>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ---- Derived data ----
  const allEntries = useMemo(() => getAllHelpEntries(), []);

  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return allEntries;
    return searchHelpEntries(searchQuery);
  }, [searchQuery, allEntries]);

  const selectedTopic = useMemo(() => {
    const id = selectedTopicId ?? helpTopicId ?? null;
    if (!id) return null;
    return getHelpEntry(id) ?? null;
  }, [selectedTopicId, helpTopicId, allEntries]);

  const isProcedure = selectedTopic?.path.includes("/procedures/") ?? false;

  const groupedEntries = useMemo(() => groupBySection(filteredEntries), [filteredEntries]);

  // ---- Initialise on open ----
  useEffect(() => {
    if (helpOpen) {
      setSearchQuery("");
      setSelectedTopicId(helpTopicId ?? null);
      setCheckedSteps(new Set());
    }
  }, [helpOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Record help page view when topic changes ----
  useEffect(() => {
    if (helpOpen && selectedTopic) {
      const key = selectedTopic.route ?? selectedTopic.id;
      recordHelpPageView(key);
    }
  }, [helpOpen, selectedTopic, recordHelpPageView]);

  // ---- Global keyboard shortcuts ----
  useEffect(() => {
    if (!helpOpen) return;

    const handler = (e: globalThis.KeyboardEvent) => {
      // Cmd+F / Ctrl+F → focus search
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [helpOpen]);

  // ---- Handlers ----
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) closeHelp();
    },
    [closeHelp],
  );

  const handleSelectTopic = useCallback(
    (id: string) => {
      setSelectedTopicId(id);
      setCheckedSteps(new Set());
    },
    [],
  );

  const handleGoToIndex = useCallback(() => {
    setSelectedTopicId(null);
    setSearchQuery("");
    searchInputRef.current?.focus();
  }, []);

  const handleSearchKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setSearchQuery("");
        searchInputRef.current?.focus();
      }
    },
    [],
  );

  const handleToggleStep = useCallback((stepIndex: number) => {
    setCheckedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepIndex)) {
        next.delete(stepIndex);
      } else {
        next.add(stepIndex);
      }
      return next;
    });
  }, []);

  // =========================================================================
  // Render
  // =========================================================================

  return (
    <Dialog.Root open={helpOpen} onOpenChange={handleOpenChange}>
      <AnimatePresence>
        {helpOpen && (
          <Dialog.Portal forceMount>
            {/* Overlay */}
            <Dialog.Overlay asChild>
              <motion.div
                className="fixed inset-0 z-40"
                style={{
                  backgroundColor: "color-mix(in srgb, var(--color-ink) 40%, transparent)",
                  backdropFilter: "blur(4px)",
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
              />
            </Dialog.Overlay>

            {/* Panel */}
            <Dialog.Content asChild>
              <motion.div
                className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-full max-w-4xl -translate-x-1/2 -translate-y-1/2 overflow-hidden focus-visible:outline-none"
                style={{
                  backgroundColor: "var(--color-panel)",
                  borderRadius: "var(--radius-pos)",
                  boxShadow: "var(--shadow-pos-elevated)",
                }}
                initial={{ opacity: 0, scale: 0.96, y: -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -8 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
              >
                {/* ================================================================= */}
                {/* Sidebar — index / search                                         */}
                {/* ================================================================= */}
                <aside
                  className="flex w-60 shrink-0 flex-col overflow-hidden"
                  style={{
                    borderRight:
                      "1px solid color-mix(in srgb, var(--color-ink) 10%, transparent)",
                    backgroundColor:
                      "color-mix(in srgb, var(--color-surface) 40%, white)",
                  }}
                >
                  {/* Search input */}
                  <div
                    className="flex items-center gap-2 px-3 py-2.5"
                    style={{
                      borderBottom:
                        "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)",
                    }}
                  >
                    {/* Magnifying glass icon */}
                    <svg
                      className="h-3.5 w-3.5 shrink-0"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden
                      style={{
                        color:
                          "color-mix(in srgb, var(--color-ink) 40%, transparent)",
                      }}
                    >
                      <path
                        d="M7.333 12.667A5.333 5.333 0 1 0 7.333 2a5.333 5.333 0 0 0 0 10.667ZM14 14l-2.9-2.9"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>

                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={handleSearchKeyDown}
                      placeholder={t("assistant.help.search")}
                      aria-label={t("assistant.help.search")}
                      className="flex-1 border-none bg-transparent text-body outline-none"
                      style={{
                        color: "var(--color-ink)",
                        fontFamily: "var(--font-ui)",
                      }}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>

                  {/* Topic list */}
                  <nav
                    className="flex-1 overflow-y-auto"
                    aria-label={t("assistant.help.index")}
                  >
                    {groupedEntries.length === 0 && searchQuery.trim() !== "" && (
                      <div className="flex flex-col items-center px-3 py-8 text-center">
                        <p
                          className="text-body-sm"
                          style={{
                            color:
                              "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                          }}
                        >
                          {t("assistant.help.emptySearch", { query: searchQuery })}
                        </p>
                      </div>
                    )}

                    {groupedEntries.map((group) => (
                      <div key={group.section}>
                        {/* Section header */}
                        <div
                          className="flex items-center px-3 py-1.5"
                          style={{
                            backgroundColor:
                              "color-mix(in srgb, var(--color-surface) 60%, white)",
                          }}
                        >
                          <span
                            className="text-caption font-semibold uppercase tracking-wider"
                            style={{
                              color:
                                "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                            }}
                          >
                            {t(sectionLabelKey(group.section))}
                          </span>
                          <span
                            className="ml-auto flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 font-data text-[10px] tabular-nums"
                            style={{
                              backgroundColor:
                                "color-mix(in srgb, var(--color-ink) 10%, transparent)",
                              color:
                                "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                            }}
                          >
                            {group.entries.length}
                          </span>
                        </div>

                        {/* Entry items */}
                        {group.entries.map((entry) => {
                          const isActive =
                            selectedTopic?.id === entry.id ||
                            helpTopicId === entry.id;
                          const viewedRecently =
                            wasHelpPageViewedRecently(entry.route ?? entry.id);

                          return (
                            <button
                              key={entry.id}
                              type="button"
                              className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors duration-75"
                              style={{
                                backgroundColor: isActive
                                  ? "color-mix(in srgb, var(--color-pharma) 8%, transparent)"
                                  : "transparent",
                                color: isActive
                                  ? "var(--color-pharma)"
                                  : "var(--color-ink)",
                              }}
                              onClick={() => handleSelectTopic(entry.id)}
                            >
                              {/* Recently-viewed indicator */}
                              {viewedRecently && (
                                <span
                                  className="mt-1.5 block h-1.5 w-1.5 shrink-0 rounded-full"
                                  style={{
                                    backgroundColor: "var(--color-pharma)",
                                    opacity: 0.5,
                                  }}
                                  aria-hidden
                                />
                              )}
                              {!viewedRecently && (
                                <span className="block w-1.5 shrink-0" aria-hidden />
                              )}

                              <span className="min-w-0 flex-1 truncate text-body-sm leading-snug">
                                {entry.title}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </nav>
                </aside>

                {/* ================================================================= */}
                {/* Content area                                                      */}
                {/* ================================================================= */}
                <main className="flex flex-1 flex-col overflow-hidden">
                  {/* Header */}
                  <div
                    className="flex items-center justify-between px-5 py-3"
                    style={{
                      borderBottom:
                        "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)",
                    }}
                  >
                    <h2
                      className="text-ui font-semibold"
                      style={{ color: "var(--color-ink)" }}
                    >
                      {t("assistant.help.title")}
                    </h2>
                    <div className="flex items-center gap-2">
                      {selectedTopic && (
                        <button
                          type="button"
                          className="pos-button pos-button-secondary text-caption"
                          onClick={handleGoToIndex}
                        >
                          {t("assistant.help.index")}
                        </button>
                      )}
                      <Dialog.Close asChild>
                        <button
                          type="button"
                          className="flex h-7 w-7 items-center justify-center rounded-pos transition-colors duration-75"
                          style={{
                            color:
                              "color-mix(in srgb, var(--color-ink) 40%, transparent)",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor =
                              "color-mix(in srgb, var(--color-ink) 8%, transparent)";
                            e.currentTarget.style.color = "var(--color-ink)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = "transparent";
                            e.currentTarget.style.color =
                              "color-mix(in srgb, var(--color-ink) 40%, transparent)";
                          }}
                          aria-label={t("common.close")}
                        >
                          <svg
                            className="h-4 w-4"
                            viewBox="0 0 16 16"
                            fill="none"
                            aria-hidden
                          >
                            <path
                              d="M12 4L4 12M4 4l8 8"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </Dialog.Close>
                    </div>
                  </div>

                  {/* Body */}
                  <div className="flex-1 overflow-y-auto px-5 py-4">
                    {selectedTopic ? (
                      <TopicContent
                        entry={selectedTopic}
                        isProcedure={isProcedure}
                        checkedSteps={checkedSteps}
                        onToggleStep={handleToggleStep}
                      />
                    ) : helpTopicId && !selectedTopic ? (
                      /* Topic not found (id provided but no match) */
                      <NotFoundState
                        onGoToIndex={handleGoToIndex}
                      />
                    ) : (
                      /* Default: welcome / index home */
                      <WelcomeIndex
                        groupedEntries={groupedEntries}
                        onSelectTopic={handleSelectTopic}
                      />
                    )}
                  </div>
                </main>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Rendered topic content: title, metadata, body, and optional procedure checklist. */
interface TopicContentProps {
  entry: HelpContentEntry;
  isProcedure: boolean;
  checkedSteps: Set<number>;
  onToggleStep: (stepIndex: number) => void;
}

const TopicContent: FC<TopicContentProps> = ({
  entry,
  isProcedure,
  checkedSteps,
  onToggleStep,
}) => {
  const { t } = useTranslation();
  const isOutdated = isOlderThanSixMonths(entry.lastUpdated);

  // Render body with optional checklist overlay for ordered lists in procedures
  const bodyContent = useMemo(() => {
    if (!isProcedure) return renderMarkdown(entry.body);

    // For procedures, add checkboxes before each <ol><li> element
    const blocks = renderMarkdown(entry.body);
    let stepCounter = 0;

    return blocks.map((block, idx) => {
      if (
        isValidElement(block) &&
        block.type === "ol"
      ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const listItems = Children.toArray((block.props as any).children).map(
          (child: ReactNode, _liIdx: number) => {
            const stepIndex = stepCounter++;
            if (isValidElement(child) && child.type === "li") {
              const isChecked = checkedSteps.has(stepIndex);
              return (
                <li
                  key={`step-${stepIndex}`}
                  className="mb-1 flex items-start gap-2"
                  style={{
                    textDecoration: isChecked ? "line-through" : "none",
                    opacity: isChecked ? 0.6 : 1,
                    color: "var(--color-ink)",
                  }}
                >
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => onToggleStep(stepIndex)}
                      className="mt-1 h-3.5 w-3.5 shrink-0 rounded-pos"
                      style={{
                        accentColor: "var(--color-pharma)",
                      }}
                      aria-label={`${t("assistant.help.step")} ${stepIndex + 1}`}
                    />
                    <span className="text-body leading-relaxed">
                      {(child.props as Record<string, unknown>).children as ReactNode}
                    </span>
                  </label>
                </li>
              );
            }
            return child;
          },
        );

        const clonedProps = {
          key: `ol-${idx}`,
          children: listItems,
        } as Record<string, unknown>;
        return cloneElement(block, clonedProps);
      }
      return block;
    });
  }, [entry.body, isProcedure, checkedSteps, onToggleStep, t]);

  return (
    <article>
      {/* Title */}
      <h1
        className="mb-1 text-heading font-bold leading-tight"
        style={{ color: "var(--color-ink)" }}
      >
        {entry.title}
      </h1>

      {/* Last updated */}
      {entry.lastUpdated && (
        <p
          className="mb-2 text-caption"
          style={{
            color:
              "color-mix(in srgb, var(--color-ink) 50%, transparent)",
          }}
        >
          {t("assistant.help.lastUpdated", {
            date: formatDate(entry.lastUpdated),
          })}
        </p>
      )}

      {/* Outdated warning */}
      {isOutdated && (
        <div
          className="mb-4 flex items-start gap-2 rounded-pos border-l-4 px-3 py-2 text-caption font-medium"
          style={{
            borderLeftColor: "var(--color-urgency)",
            backgroundColor: "var(--color-urgency-surface)",
            color: "var(--color-urgency)",
          }}
          role="alert"
        >
          <svg
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden
          >
            <path
              d="M8 5v3.333M8 11.333h.007M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>
            {t("assistant.help.outdated", {
              date: formatDate(entry.lastUpdated),
            })}
          </span>
        </div>
      )}

      {/* Procedure checklist header */}
      {isProcedure && (
        <div
          className="mb-3 flex items-center gap-2 rounded-pos px-3 py-2 text-caption font-medium"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--color-pharma) 8%, transparent)",
            color: "var(--color-pharma)",
          }}
        >
          <svg
            className="h-3.5 w-3.5 shrink-0"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden
          >
            <path
              d="M13.333 4L5.333 12 2.667 9.333"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>
            {checkedSteps.size}/{countOrderedListItems(entry.body)}{" "}
            {t("assistant.help.stepsCompleted")}
          </span>
        </div>
      )}

      {/* Body (rendered Markdown) */}
      <div className="space-y-1">{bodyContent}</div>
    </article>
  );
};

/** Count the number of ordered list items in a markdown body. */
function countOrderedListItems(body: string): number {
  const matches = body.match(/^\d+\.\s+/gm);
  return matches ? matches.length : 0;
}

// ---------------------------------------------------------------------------

/** Shown when a helpTopicId was provided but no matching entry was found. */
interface NotFoundStateProps {
  onGoToIndex: () => void;
}

const NotFoundState: FC<NotFoundStateProps> = ({ onGoToIndex }) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <svg
        className="mb-4 h-10 w-10"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
        style={{
          color: "color-mix(in srgb, var(--color-ink) 25%, transparent)",
        }}
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M12 8v4M12 16h.007"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <p
        className="mb-2 text-body font-medium"
        style={{ color: "var(--color-ink)" }}
      >
        {t("assistant.help.notFound")}
      </p>
      <button
        type="button"
        className="pos-button pos-button-secondary text-caption"
        onClick={onGoToIndex}
      >
        {t("assistant.help.fallback")}
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------

/** Default welcome view — shows the full index when no topic is selected. */
interface WelcomeIndexProps {
  groupedEntries: { section: EntrySection; entries: HelpContentEntry[] }[];
  onSelectTopic: (id: string) => void;
}

const WelcomeIndex: FC<WelcomeIndexProps> = ({
  groupedEntries,
  onSelectTopic,
}) => {
  const { t } = useTranslation();

  // Try to show the help-index.md content as a welcome
  const indexEntry = useMemo(() => getHelpEntry("help-index"), []);

  if (indexEntry) {
    return <TopicContent entry={indexEntry} isProcedure={false} checkedSteps={new Set()} onToggleStep={() => {}} />;
  }

  // Fallback: show grouped topics inline
  return (
    <div>
      <h1
        className="mb-4 text-heading font-bold"
        style={{ color: "var(--color-ink)" }}
      >
        {t("assistant.help.title")}
      </h1>
      <p
        className="mb-6 text-body"
        style={{
          color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
        }}
      >
        {t("assistant.help.selectTopic")}
      </p>
      {groupedEntries.map((group) => (
        <div key={group.section} className="mb-6">
          <h3
            className="mb-2 text-ui font-semibold"
            style={{ color: "var(--color-ink)" }}
          >
            {t(sectionLabelKey(group.section))}
          </h3>
          <ul className="space-y-1">
            {group.entries.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className="text-body underline-offset-2 transition-colors duration-75 hover:underline"
                  style={{ color: "var(--color-pharma)" }}
                  onClick={() => onSelectTopic(entry.id)}
                >
                  {entry.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};
