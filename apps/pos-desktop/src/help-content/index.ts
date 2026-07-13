/**
 * Help content barrel — loads all Markdown help files at build time via
 * Vite's import.meta.glob and provides a typed lookup service.
 *
 * Each Markdown file should contain frontmatter with:
 * - id: stable identifier used for route bindings and palette search
 * - title: human-readable title
 * - keywords: search keywords
 * - audience: cashier / manager / both
 * - lastUpdated: ISO date string
 */

export interface HelpContentEntry {
  id: string;
  title: string;
  keywords: string[];
  audience: string;
  lastUpdated: string;
  route?: string;
  path: string;
  body: string;
}

// ---------------------------------------------------------------------------
// Vite glob — eagerly loaded at build time
// ---------------------------------------------------------------------------

const helpModules = import.meta.glob("/src/help-content/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// ---------------------------------------------------------------------------
// Simple frontmatter parser (no YAML dependency)
// ---------------------------------------------------------------------------

function parseFrontmatter(content: string): {
  id: string;
  title: string;
  keywords: string[];
  audience: string;
  lastUpdated: string;
  route?: string;
} | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const lines = match[1].split("\n");
  const result: Record<string, any> = {};
  let currentKey = "";

  for (const line of lines) {
    const kvMatch = line.match(/^(\w+):\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const val = kvMatch[2].replace(/^["']|["']$/g, "").trim();
      result[currentKey] = val;
    } else if (line.match(/^\s+-\s/)) {
      const val = line.replace(/^\s*-\s*/, "").replace(/^["']|["']$/g, "").trim();
      if (Array.isArray(result[currentKey])) {
        result[currentKey].push(val);
      } else if (currentKey) {
        result[currentKey] = [val];
      }
    }
  }

  if (!result.id || !result.title) return null;

  return {
    id: result.id as string,
    title: result.title as string,
    keywords: Array.isArray(result.keywords) ? result.keywords : [],
    audience: (result.audience as string) || "both",
    lastUpdated: (result.lastUpdated as string) || "",
    route: result.route as string | undefined,
  };
}

// ---------------------------------------------------------------------------
// Build the help content index
// ---------------------------------------------------------------------------

const helpEntries: Record<string, HelpContentEntry> = {};

for (const [path, rawContent] of Object.entries(helpModules)) {
  const content = rawContent as string;
  const frontmatter = parseFrontmatter(content);

  if (frontmatter) {
    const body = content.replace(/^---[\s\S]*?---\n?/, "").trim();
    helpEntries[frontmatter.id] = {
      ...frontmatter,
      path,
      body,
    };
  }
}

// ---------------------------------------------------------------------------
// Lookup functions
// ---------------------------------------------------------------------------

/**
 * Get a help entry by its stable ID.
 */
export function getHelpEntry(id: string): HelpContentEntry | undefined {
  return helpEntries[id];
}

/**
 * Get a help entry by route (route-based help for F1).
 */
export function getHelpEntryByRoute(
  route: string,
): HelpContentEntry | undefined {
  return Object.values(helpEntries).find((e) => e.route === route);
}

/**
 * Get all help entries.
 */
export function getAllHelpEntries(): HelpContentEntry[] {
  return Object.values(helpEntries);
}

/**
 * Search help entries by keyword or title.
 * Falls back even when the frontmatter or index isn't available.
 */
export function searchHelpEntries(
  query: string,
): HelpContentEntry[] {
  const lower = query.toLowerCase();
  return Object.values(helpEntries).filter(
    (entry) =>
      entry.title.toLowerCase().includes(lower) ||
      entry.keywords.some((kw) => kw.toLowerCase().includes(lower)) ||
      entry.body.toLowerCase().includes(lower),
  );
}
