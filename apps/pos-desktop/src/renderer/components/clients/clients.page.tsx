/**
 * Clients page — search, view, create, edit, and delete clients.
 *
 * Orchestration container with motion entrance, notify toasts,
 * slide-in edit panel, and overlay delete dialog.
 * Delegates presentation to extracted sub-components.
 *
 * @category Page
 */
import {
  type FC,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import {
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useClientsService } from "../common/service-context";
import type { ClientSearchResult, CreateClientInput } from "../../../domain/clients/clients.service";
import type { UpdateClientInput } from "../../../domain/clients/clients.service";
import { useLocalSessionStore } from "../../../domain/auth/local-session.store";
import { notify } from "@/utils/notify";
import { ClientForm } from "./client-form";
import { ClientTable } from "./client-table";
import { DeleteConfirmDialog } from "./delete-confirm-dialog";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_FORM: CreateClientInput = {
  fullName: "",
  identificationType: "CC",
  identificationNumber: "",
  email: "",
  phone: "",
  address: "",
  municipality: "",
  department: "",
};

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const pageVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { when: "beforeChildren", staggerChildren: 0.05 },
  },
};

const headerVariants: Variants = {
  hidden: { opacity: 0, y: -8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2, ease: "easeOut" } },
};

const slideInVariants: Variants = {
  hidden: { x: "100%" },
  visible: {
    x: 0,
    transition: { type: "spring", damping: 28, stiffness: 300, mass: 0.8 },
  },
  exit: {
    x: "100%",
    transition: { duration: 0.2, ease: "easeIn" },
  },
};

const overlayVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ClientsPage: FC = () => {
  const { t } = useTranslation();
  const clientsService = useClientsService();
  const session = useLocalSessionStore((s) => s.session);
  const canCreate = !!session;
  const shouldReduceMotion = useReducedMotion();

  // ---- Search state ----
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<ClientSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ---- Sync state ----
  const [isSyncing, setIsSyncing] = useState(false);

  // ---- Create form state ----
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState<CreateClientInput>(INITIAL_FORM);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // ---- Edit state (slide-in panel) ----
  const [editingClient, setEditingClient] = useState<ClientSearchResult | null>(null);
  const [editFormData, setEditFormData] = useState<UpdateClientInput>(INITIAL_FORM);
  const [isUpdating, setIsUpdating] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // ---- Delete state ----
  const [deleteConfirmClient, setDeleteConfirmClient] = useState<ClientSearchResult | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // ---- Search ----
  const doSearch = useCallback(
    async (query: string) => {
      setIsSearching(true);
      setSearchError(null);
      try {
        const data = await clientsService.search(query || undefined);
        setResults(data);
      } catch (err) {
        console.error("[ClientsPage] search failed:", err);
        setResults([]);
        setSearchError(err instanceof Error ? err.message : t("common.unexpected_error"));
      } finally {
        setIsSearching(false);
      }
    },
    [clientsService, t],
  );

  // Sync from server
  const handleSync = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const count = await clientsService.pullFromServer();
      notify.success({
        title: t("clients.sync_done", { count }),
      });
      await doSearch(searchQuery);
    } catch (err) {
      console.error("[ClientsPage] sync failed:", err);
      notify.error({
        title: err instanceof Error ? err.message : t("common.unexpected_error"),
      });
    } finally {
      setIsSyncing(false);
    }
  }, [clientsService, doSearch, searchQuery, t, isSyncing]);

  // On mount: sync then search
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (!initialLoadDone.current) {
      initialLoadDone.current = true;
      setHasLoaded(true);
      void (async () => {
        try {
          setIsSyncing(true);
          await clientsService.pullFromServer();
        } catch {
          // silent — offline-first, local data still works
        } finally {
          setIsSyncing(false);
        }
        void doSearch("");
      })();
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void doSearch(searchQuery), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, doSearch, clientsService]);

  // Focus search input on mount
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // ---- Create ----
  const handleCreate = useCallback(async () => {
    setIsCreating(true);
    setCreateError(null);
    try {
      await clientsService.create(formData);
      setShowCreateForm(false);
      setFormData(INITIAL_FORM);
      notify.success({ title: t("clients.create_success") });
      void doSearch(searchQuery);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t("common.unexpected_error"));
    } finally {
      setIsCreating(false);
    }
  }, [formData, clientsService, doSearch, searchQuery, t]);

  // ---- Edit ----
  const handleStartEdit = useCallback((client: ClientSearchResult) => {
    setEditingClient(client);
    setEditFormData({
      fullName: client.fullName,
      identificationType: client.identificationType,
      identificationNumber: client.identificationNumber,
      email: client.email ?? "",
      phone: client.phone ?? "",
      address: client.address ?? "",
      municipality: client.municipality ?? "",
      department: client.department ?? "",
    });
    setEditError(null);
    setShowCreateForm(false);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingClient(null);
    setEditError(null);
  }, []);

  const handleUpdate = useCallback(async () => {
    if (!editingClient) return;
    setIsUpdating(true);
    setEditError(null);
    try {
      await clientsService.update(editingClient.id, editFormData);
      setEditingClient(null);
      notify.success({ title: t("clients.update_success") });
      void doSearch(searchQuery);
    } catch (err) {
      console.error("[ClientsPage] update failed:", err);
      setEditError(err instanceof Error ? err.message : t("common.unexpected_error"));
    } finally {
      setIsUpdating(false);
    }
  }, [editingClient, editFormData, clientsService, doSearch, searchQuery, t]);

  // ---- Delete ----
  const handleStartDelete = useCallback((clientId: string) => {
    const client = results.find((c) => c.id === clientId) ?? null;
    setDeleteConfirmClient(client);
  }, [results]);

  const handleCancelDelete = useCallback(() => {
    setDeleteConfirmClient(null);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!deleteConfirmClient) return;
    setIsDeleting(true);
    try {
      await clientsService.deactivate(deleteConfirmClient.id);
      notify.success({ title: t("clients.delete_success") });
      setDeleteConfirmClient(null);
      void doSearch(searchQuery);
    } catch (err) {
      console.error("[ClientsPage] delete failed:", err);
      notify.error({
        title: err instanceof Error ? err.message : t("common.unexpected_error"),
      });
    } finally {
      setIsDeleting(false);
    }
  }, [deleteConfirmClient, clientsService, doSearch, searchQuery, t]);

  // ---- Clear search ----
  const clearSearch = useCallback(() => {
    setSearchQuery("");
    searchInputRef.current?.focus();
  }, []);

  // ---- Render ----
  return (
    <motion.div
      className="flex h-full flex-col gap-4 overflow-hidden p-6"
      variants={pageVariants}
      initial={shouldReduceMotion ? undefined : "hidden"}
      animate="visible"
    >
      {/* ===== Header row ===== */}
      <motion.div
        className="flex items-center justify-between"
        variants={headerVariants}
      >
        <h1 className="pos-page-title m-0">{t("clients.title")}</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSync}
            disabled={isSyncing}
            className="inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-body-sm font-semibold transition-colors"
            style={{
              backgroundColor: "var(--color-panel)",
              color: "var(--color-ink)",
              borderColor: "color-mix(in srgb, var(--color-ink) 15%, transparent)",
            }}
            title={t("clients.sync_tooltip")}
          >
            <RefreshCw className={`size-4 ${isSyncing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">{isSyncing ? t("common.loading") : t("clients.sync")}</span>
          </button>

          {canCreate && !showCreateForm && !editingClient && (
            <button
              type="button"
              onClick={() => setShowCreateForm(true)}
              className="inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-body-sm font-semibold text-white transition-all hover:brightness-110"
              style={{ backgroundColor: "var(--color-pharma)" }}
            >
              <Plus className="size-4" />
              {t("clients.create")}
            </button>
          )}
        </div>
      </motion.div>

      {/* ===== Search bar with clear button ===== */}
      <motion.div
        className="relative"
        variants={headerVariants}
      >
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2"
            style={{ color: "color-mix(in srgb, var(--color-ink) 35%, transparent)", pointerEvents: "none" }}
          />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("clients.search_placeholder")}
            className="w-full rounded-sm border py-2 pl-8 pr-8 text-body outline-none transition-shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma"
            style={{
              backgroundColor: "var(--color-panel)",
              borderColor: "color-mix(in srgb, var(--color-ink) 12%, transparent)",
            }}
            aria-label={t("clients.search_placeholder")}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm opacity-50 transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-pharma"
              aria-label={t("common.clear")}
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </motion.div>

      {/* ===== Create form (inline with AnimatePresence) ===== */}
      <AnimatePresence mode="wait">
        {showCreateForm && (
          <motion.div
            key="create-form"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: shouldReduceMotion ? 0.01 : 0.2 }}
          >
            <ClientForm
              mode="create"
              data={formData}
              onChange={setFormData}
              onSubmit={handleCreate}
              onCancel={() => { setShowCreateForm(false); setCreateError(null); }}
              isSubmitting={isCreating}
              error={createError}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== Edit slide-in panel ===== */}
      <AnimatePresence>
        {editingClient && (
          <>
            {/* Overlay */}
            <motion.div
              key="edit-overlay"
              className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
              variants={overlayVariants}
              initial={shouldReduceMotion ? undefined : "hidden"}
              animate="visible"
              exit="exit"
              onClick={handleCancelEdit}
            />

            {/* Slide-in panel */}
            <motion.div
              key="edit-panel"
              className="fixed right-0 top-0 z-50 h-full w-full max-w-lg overflow-y-auto bg-white shadow-lg"
              variants={slideInVariants}
              initial={shouldReduceMotion ? undefined : "hidden"}
              animate="visible"
              exit="exit"
              style={{
                borderLeft: "1px solid color-mix(in srgb, var(--color-ink) 10%, transparent)",
              }}
            >
              <div className="p-5">
                <ClientForm
                  mode="edit"
                  data={editFormData}
                  onChange={setEditFormData}
                  onSubmit={handleUpdate}
                  onCancel={handleCancelEdit}
                  isSubmitting={isUpdating}
                  error={editError}
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ===== Search error banner (animated) ===== */}
      <AnimatePresence>
        {searchError && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="flex items-center gap-1.5 rounded-sm px-3 py-2 text-body-sm"
            style={{
              backgroundColor: "var(--color-error-container)",
              color: "var(--color-error)",
            }}
            role="alert"
          >
            <span>{searchError}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== Results table ===== */}
      <motion.div
        className="flex-1 overflow-hidden rounded-sm"
        style={{
          border: "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)",
          backgroundColor: "var(--color-panel)",
        }}
        variants={headerVariants}
      >
        <ClientTable
          results={results}
          isSearching={isSearching}
          hasLoaded={hasLoaded}
          onEdit={handleStartEdit}
          onDelete={handleStartDelete}
        />
      </motion.div>

      {/* ===== Delete confirmation dialog ===== */}
      <DeleteConfirmDialog
        isOpen={deleteConfirmClient !== null}
        isDeleting={isDeleting}
        clientName={deleteConfirmClient?.fullName}
        onConfirm={handleDelete}
        onCancel={handleCancelDelete}
      />
    </motion.div>
  );
};
