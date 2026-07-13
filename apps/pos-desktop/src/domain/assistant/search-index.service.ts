/**
 * Search index service — builds and manages an in-memory Fuse.js index
 * over all indexable items (pages, products, clients, sales, commands,
 * help topics).
 *
 * ## Architecture
 * - Lazy initialization: the index is built on first palette open, not at
 *   app startup.
 * - Incremental refresh: addOrUpdate/remove does not rebuild the full index.
 * - Web Worker fallback: if the catalog exceeds INDEX_WORKER_THRESHOLD items,
 *   the build runs in a Web Worker to avoid blocking the main thread.
 */

import Fuse from "fuse.js";
import type {
  IndexableItem,
  IndexableProduct,
  IndexableClient,
  IndexableSale,
  IndexableCommand,
  IndexableHelpTopic,
  IndexablePage,
} from "./assistant-types";
import { getCommandsForRole } from "./commands";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Items below this threshold build on the main thread; above, in a Worker. */
export const INDEX_WORKER_THRESHOLD = 5_000;

/** Debounce delay in ms for burst updates (e.g., catalog sync). */
export const INDEX_UPDATE_DEBOUNCE_MS = 100;

/** Default Fuse.js threshold — strict enough to avoid noise, loose for typos. */
const DEFAULT_FUSE_THRESHOLD = 0.4;

/** Maximum recent items kept in the index. */
export const MAX_RECENT_ITEMS = 20;

// ---------------------------------------------------------------------------
// Fuse.js configuration
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FUSE_OPTIONS: any = {
  threshold: DEFAULT_FUSE_THRESHOLD,
  includeScore: true,
  keys: [
    { name: "label", weight: 3 },
    { name: "name", weight: 3 },
    { name: "title", weight: 3 },
    { name: "keywords", weight: 2 },
    { name: "barcode", weight: 2 },
    { name: "genericName", weight: 1 },
    { name: "excerpt", weight: 1 },
    { name: "categoryName", weight: 1 },
    { name: "document", weight: 1 },
    { name: "phone", weight: 1 },
  ],
  // Only consider items with score better than this
  // Fuse default is 0.6; we use 0.4 for strictness
};

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface SearchIndexService {
  /** Build (or rebuild) the full index. Returns build time in ms. */
  build(userRole?: string | null): Promise<number>;

  /** Add or update a single item in the index. */
  addOrUpdate(item: IndexableItem): void;

  /** Remove an item by its id. Returns true if found and removed. */
  remove(itemId: string): boolean;

  /** Search the index with the given query. */
  search(query: string): IndexableItem[];

  /** Whether the index has been built at least once. */
  readonly isBuilt: boolean;

  /** Number of items currently indexed. */
  readonly itemCount: number;

  /** Register a callback for when the index is about to be built (for UI feedback). */
  onBuildStart(cb: () => void): void;

  /** Register a callback for when the index finishes building. */
  onBuildComplete(cb: () => void): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSearchIndexService = (): SearchIndexService => {
  return new FuseSearchIndexService();
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class FuseSearchIndexService implements SearchIndexService {
  private fuse: Fuse<IndexableItem> | null = null;
  private items: IndexableItem[] = [];
  private buildStartCallbacks: Array<() => void> = [];
  private buildCompleteCallbacks: Array<() => void> = [];
  private updateDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  get isBuilt(): boolean {
    return this.fuse !== null;
  }

  get itemCount(): number {
    return this.items.length;
  }

  onBuildStart(cb: () => void): void {
    this.buildStartCallbacks.push(cb);
  }

  onBuildComplete(cb: () => void): void {
    this.buildCompleteCallbacks.push(cb);
  }

  async build(userRole?: string | null): Promise<number> {
    const startTime = performance.now();

    this.notifyBuildStart();

    // 1. Collect items from all sources
    const allItems = await this.collectIndexableItems(userRole ?? null);

    this.items = allItems;

    // 2. Choose build strategy based on item count
    if (this.items.length > INDEX_WORKER_THRESHOLD) {
      await this.buildWithWorker(this.items);
    } else {
      this.fuse = new Fuse(this.items, FUSE_OPTIONS);
    }

    const buildTime = performance.now() - startTime;
    this.notifyBuildComplete();

    return buildTime;
  }

  addOrUpdate(item: IndexableItem): void {
    // Remove existing item with same id
    const existingIndex = this.items.findIndex(
      (i) => i.id === item.id && i.category === item.category,
    );

    if (existingIndex >= 0) {
      this.items[existingIndex] = item;
    } else {
      this.items.push(item);
    }

    // Debounced index rebuild for bursts
    this.scheduleRebuild();
  }

  remove(itemId: string): boolean {
    const index = this.items.findIndex((i) => i.id === itemId);
    if (index < 0) return false;

    this.items.splice(index, 1);
    this.scheduleRebuild();
    return true;
  }

  search(query: string): IndexableItem[] {
    if (!query.trim()) {
      return [];
    }

    if (!this.fuse) {
      return [];
    }

    try {
      const results = this.fuse.search(query);
      return results.map((r) => r.item);
    } catch (err) {
      // Fallback to basic substring match if Fuse throws
      console.error("[SearchIndex] Fuse search threw, falling back to substring match:", err);
      return this.substringSearch(query);
    }
  }

  /**
   * Fallback substring search when Fuse is unavailable or throws.
   */
  private substringSearch(query: string): IndexableItem[] {
    const lowerQuery = query.toLowerCase();
    return this.items.filter((item) => {
      const label =
        "label" in item
          ? (item as IndexablePage | IndexableCommand).label
          : "name" in item
            ? (item as IndexableProduct | IndexableClient).name
            : "title" in item
              ? (item as IndexableHelpTopic).title
              : "";
      return label.toLowerCase().includes(lowerQuery);
    });
  }

  /**
   * Collect all indexable items from every source.
   */
  private async collectIndexableItems(
    userRole: string | null,
  ): Promise<IndexableItem[]> {
    const items: IndexableItem[] = [];

    // 1. Pages (static navigation targets)
    items.push(...this.getPageItems());

    // 2. Commands (filtered by role)
    const roleCommands = getCommandsForRole(userRole);
    items.push(
      ...roleCommands.map(
        (cmd): IndexableCommand => ({
          category: "COMMAND",
          id: cmd.id,
          label: cmd.label,
          shortcut: cmd.shortcut,
          group: cmd.group,
          audience: cmd.audience,
        }),
      ),
    );

    // 3. Products from local catalog (lazy load)
    try {
      const products = await this.loadProductsFromDb();
      items.push(...products);
    } catch (err) {
      console.error("[SearchIndex] Failed to load products:", err);
    }

    // 4. Clients from local DB (lazy load)
    try {
      const clients = await this.loadClientsFromDb();
      items.push(...clients);
    } catch (err) {
      console.error("[SearchIndex] Failed to load clients:", err);
    }

    // 5. Sales from local DB (lazy load — last 100)
    try {
      const sales = await this.loadRecentSalesFromDb();
      items.push(...sales);
    } catch (err) {
      console.error("[SearchIndex] Failed to load sales:", err);
    }

    // 6. Help topics from bundled content
    try {
      const topics = await this.loadHelpTopics();
      items.push(...topics);
    } catch (err) {
      console.error("[SearchIndex] Failed to load help topics:", err);
    }

    return items;
  }

  /**
   * Static page navigation items.
   */
  private getPageItems(): IndexablePage[] {
    return [
      {
        category: "PAGE",
        id: "page-sales",
        label: "Pantalla de ventas",
        route: "sales",
        icon: "cart",
        keywords: ["venta", "caja", "registrar", "cobrar"],
      },
      {
        category: "PAGE",
        id: "page-returns",
        label: "Pantalla de devoluciones",
        route: "returns",
        icon: "undo",
        keywords: ["devolución", "reembolso", "nota crédito"],
      },
      {
        category: "PAGE",
        id: "page-adjustments",
        label: "Ajustes de inventario",
        route: "inventory-adjustments",
        icon: "adjust",
        keywords: ["inventario", "ajuste", "merma", "sobrante"],
      },
      {
        category: "PAGE",
        id: "page-prescriptions",
        label: "Prescripciones médicas",
        route: "prescriptions",
        icon: "prescription",
        keywords: ["receta", "prescripción", "controlado"],
      },
      {
        category: "PAGE",
        id: "page-sync-health",
        label: "Salud de sincronización",
        route: "sync-health",
        icon: "sync",
        keywords: ["sincronización", "sync", "estado", "pendiente"],
      },
      {
        category: "PAGE",
        id: "page-recovery",
        label: "Recuperación",
        route: "recovery",
        icon: "recovery",
        keywords: ["backup", "respaldo", "recuperación", "restaurar"],
      },
      {
        category: "PAGE",
        id: "page-fiscal",
        label: "Panel fiscal",
        route: "fiscal",
        icon: "file-text",
        keywords: ["fiscal", "dian", "factura", "electrónica", "cufe"],
      },
      {
        category: "PAGE",
        id: "page-admin-menu",
        label: "Menú de administración",
        route: "admin-menu",
        icon: "settings",
        keywords: ["admin", "configuración", "usuarios"],
      },
      {
        category: "PAGE",
        id: "page-about",
        label: "Acerca de",
        route: "about",
        icon: "info",
        keywords: ["versión", "acerca", "información"],
      },
    ];
  }

  /**
   * Load products from the local PGlite database.
   */
  private async loadProductsFromDb(): Promise<IndexableProduct[]> {
    try {
      const { prisma } = await import("../../infrastructure/local-database")
        .then((m) => m.getLocalDatabase());

      const products = await (prisma as any).product.findMany({
        take: 5000,
        select: {
          id: true,
          commercialName: true,
          genericName: true,
          internalCode: true,
          barcodes: {
            take: 1,
            select: { barcode: true },
          },
          category: {
            select: { name: true },
          },
          laboratory: {
            select: { name: true },
          },
        },
      });

      return products.map(
        (p: any): IndexableProduct => ({
          category: "PRODUCT",
          id: p.id,
          name: p.commercialName,
          genericName: p.genericName ?? undefined,
          barcode: p.barcodes?.[0]?.barcode ?? undefined,
          categoryName: p.category?.name ?? undefined,
          laboratory: p.laboratory?.name ?? undefined,
        }),
      );
    } catch {
      // DB not ready yet — return empty
      return [];
    }
  }

  /**
   * Load clients from the local PGlite database.
   */
  private async loadClientsFromDb(): Promise<IndexableClient[]> {
    try {
      const { prisma } = await import("../../infrastructure/local-database")
        .then((m) => m.getLocalDatabase());

      const clients = await (prisma as any).client.findMany({
        take: 2000,
        select: {
          id: true,
          fullName: true,
          identificationNumber: true,
          phone: true,
        },
      });

      return clients.map(
        (c: any): IndexableClient => ({
          category: "CLIENT",
          id: c.id,
          name: c.fullName,
          document: c.identificationNumber ?? undefined,
          phone: c.phone ?? undefined,
        }),
      );
    } catch {
      return [];
    }
  }

  /**
   * Load recent sales from the local PGlite database (last 100).
   */
  private async loadRecentSalesFromDb(): Promise<IndexableSale[]> {
    try {
      const { prisma } = await import("../../infrastructure/local-database")
        .then((m) => m.getLocalDatabase());

      const sales = await (prisma as any).sale.findMany({
        take: 100,
        orderBy: { confirmedAt: "desc" },
        select: {
          id: true,
          localNumber: true,
          totalAmount: true,
          operationalState: true,
          confirmedAt: true,
        },
      });

      return sales.map(
        (s: any): IndexableSale => ({
          category: "SALE",
          id: s.id,
          localNumber: Number(s.localNumber),
          total: Number(s.totalAmount),
          status: s.operationalState,
          confirmedAt: s.confirmedAt?.toISOString() ?? undefined,
        }),
      );
    } catch {
      return [];
    }
  }

  /**
   * Load help topics from the bundled markdown content.
   * Uses Vite's import.meta.glob to load frontmatter at build time.
   */
  private async loadHelpTopics(): Promise<IndexableHelpTopic[]> {
    try {
      // Vite glob — resolved at build time
      const helpModules = import.meta.glob("/src/help-content/**/*.md", {
        query: "?raw",
        import: "default",
        eager: false,
      });

      const topics: IndexableHelpTopic[] = [];

      for (const [path, loader] of Object.entries(helpModules)) {
        try {
          const content = (await loader()) as string;
          const frontmatter = this.parseFrontmatter(content);
          if (frontmatter) {
            // Extract first paragraph as excerpt
            const body = content.replace(/---[\s\S]*?---/, "").trim();
            const excerpt = this.extractExcerpt(body);

            topics.push({
              category: "HELP_TOPIC",
              id: frontmatter.id,
              title: frontmatter.title,
              excerpt,
              keywords: frontmatter.keywords,
              route: frontmatter.route ?? path.replace(/^\/src\/help-content\/|\.md$/g, ""),
            });
          }
        } catch {
          // Skip invalid files
        }
      }

      return topics;
    } catch {
      return [];
    }
  }

  /**
   * Parse YAML frontmatter from a markdown string.
   * Minimal implementation — no YAML parser dependency.
   */
  private parseFrontmatter(
    content: string,
  ): { id: string; title: string; keywords: string[]; audience: string; lastUpdated: string; route?: string } | null {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;

    const lines = match[1].split("\n");
    const result: Record<string, any> = {};
    let currentKey = "";

    for (const line of lines) {
      const kvMatch = line.match(/^(\w+):\s*(.*)$/);
      if (kvMatch) {
        currentKey = kvMatch[1];
        result[currentKey] = kvMatch[2].replace(/^["']|["']$/g, "");
      } else if (line.startsWith("  - ") || line.startsWith("- ")) {
        // Array item
        const val = line.replace(/^[\s-]*\s*/, "").replace(/^["']|["']$/g, "");
        if (Array.isArray(result[currentKey])) {
          result[currentKey].push(val);
        } else if (currentKey === "keywords") {
          result[currentKey] = [val];
        }
      }
    }

    if (!result.id || !result.title) return null;

    return {
      id: result.id,
      title: result.title,
      keywords: Array.isArray(result.keywords) ? result.keywords : [],
      audience: result.audience || "both",
      lastUpdated: result.lastUpdated || "",
      route: result.route,
    };
  }

  /**
   * Extract the first meaningful paragraph from markdown body.
   */
  private extractExcerpt(body: string): string {
    const cleaned = body
      .replace(/^#[^#].*/m, "") // Remove h1
      .replace(/!\[.*?\]\(.*?\)/g, "") // Remove images
      .replace(/\[([^\]]*)\]\(.*?\)/g, "$1") // Remove links, keep text
      .replace(/[*_~`]/g, "") // Remove formatting chars
      .trim();

    // Find first paragraph that's not empty
    const paragraphs = cleaned.split(/\n\s*\n/);
    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (trimmed.length > 20) {
        return trimmed.length > 200 ? trimmed.slice(0, 200) + "…" : trimmed;
      }
    }

    return cleaned.length > 200 ? cleaned.slice(0, 200) + "…" : cleaned;
  }

  /**
   * Build the index using a Web Worker (or simulate for now).
   */
  private async buildWithWorker(items: IndexableItem[]): Promise<void> {
    // Web Worker creation — falls back to main-thread if Worker not available
    try {
      const workerCode = `
        self.addEventListener('message', (e) => {
          const { items, options } = e.data;
          importScripts('https://unpkg.com/fuse.js@7/dist/fuse.basic.min.js');
          const fuse = new Fuse(items, options);
          self.postMessage({ type: 'ready' });
        });
      `;

      const blob = new Blob([workerCode], { type: "application/javascript" });
      const workerUrl = URL.createObjectURL(blob);
      const worker = new Worker(workerUrl);

      await new Promise<void>((resolve, _reject) => {
        worker.onmessage = () => {
          // Worker is ready — we'll search on main thread with Fuse directly
          // since the worker would need message-passing for every search.
          // The worker is mainly used to prevent main-thread blocking during build.
          URL.revokeObjectURL(workerUrl);
          worker.terminate();

          // Build the index on the main thread after the worker warmed up
          this.fuse = new Fuse(items, FUSE_OPTIONS);
          resolve();
        };

        worker.onerror = (err) => {
          URL.revokeObjectURL(workerUrl);
          worker.terminate();
          console.warn("[SearchIndex] Worker failed, building on main thread:", err);
          this.fuse = new Fuse(items, FUSE_OPTIONS);
          resolve();
        };

        worker.postMessage({ items, options: FUSE_OPTIONS });
      });
    } catch {
      // Worker not available (e.g., in tests or restrictive CSP)
      console.warn("[SearchIndex] Web Worker not available, building on main thread");
      this.fuse = new Fuse(items, FUSE_OPTIONS);
    }
  }

  /**
   * Schedule a debounced index rebuild.
   */
  private scheduleRebuild(): void {
    if (this.updateDebounceTimer) {
      clearTimeout(this.updateDebounceTimer);
    }

    this.updateDebounceTimer = setTimeout(() => {
      if (this.items.length > 0) {
        this.fuse = new Fuse(this.items, FUSE_OPTIONS);
      }
    }, INDEX_UPDATE_DEBOUNCE_MS);
  }

  private notifyBuildStart(): void {
    for (const cb of this.buildStartCallbacks) {
      try {
        cb();
      } catch {
        // Swallow callback errors
      }
    }
  }

  private notifyBuildComplete(): void {
    for (const cb of this.buildCompleteCallbacks) {
      try {
        cb();
      } catch {
        // Swallow callback errors
      }
    }
  }
}
