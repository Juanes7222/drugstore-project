/**
 * Client selector — search input + dropdown for selecting a client during sale.
 *
 * Uses the ClientsService from domain services to search locally.
 * Respects tenant config for whether client is REQUIRED, OPTIONAL, or HIDDEN.
 *
 * When HIDDEN → renders nothing.
 * When REQUIRED → shows a prominent search with validation indicator.
 * When OPTIONAL → shows a collapsed "Agregar cliente" button that expands.
 */
import {
  type FC,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useFieldRequirementFor } from "../../../domain/config/use-field-requirement";
import { useClientsService } from "../common/service-context";
import type { ClientSearchResult } from "../../../domain/clients";
import type { CreateClientInput } from "../../../domain/clients";
import type { ClientSelection } from "../../hooks/use-sales-transaction";
import { QuickClientForm } from "./quick-client-form";

interface ClientSelectorProps {
  selectedClient: ClientSelection | null;
  onSelectClient: (client: ClientSelection) => void;
  onClearClient: () => void;
  /** When provided, enables quick client creation from the search dropdown. */
  onCreateClient?: (input: CreateClientInput) => Promise<ClientSelection>;
}

export const ClientSelector: FC<ClientSelectorProps> = ({
  selectedClient,
  onSelectClient,
  onClearClient,
  onCreateClient,
}) => {
  const clientsService = useClientsService();
  const clientRequirement = useFieldRequirementFor("clientRequired");

  // HIDDEN → render nothing
  if (clientRequirement === "HIDDEN") {
    return null;
  }

  return (
    <ClientSelectorInner
      selectedClient={selectedClient}
      onSelectClient={onSelectClient}
      onClearClient={onClearClient}
      onCreateClient={onCreateClient}
      clientsService={clientsService}
      clientRequirement={clientRequirement}
    />
  );
};

// ---------------------------------------------------------------------------
// Inner component — receives already-resolved services & config
// ---------------------------------------------------------------------------

interface ClientSelectorInnerProps {
  selectedClient: ClientSelection | null;
  onSelectClient: (client: ClientSelection) => void;
  onClearClient: () => void;
  onCreateClient?: (input: CreateClientInput) => Promise<ClientSelection>;
  clientsService: {
    search: (query?: string) => Promise<ClientSearchResult[]>;
  };
  clientRequirement: "REQUIRED" | "OPTIONAL" | "HIDDEN";
}

const ClientSelectorInner: FC<ClientSelectorInnerProps> = ({
  selectedClient,
  onSelectClient,
  onClearClient,
  onCreateClient,
  clientsService,
  clientRequirement,
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClientSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Quick-create form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createFormData, setCreateFormData] = useState<CreateClientInput>({
    fullName: "",
    identificationType: "CC",
    identificationNumber: "",
    email: "",
    phone: "",
    address: "",
    municipality: "",
    department: "",
  });
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const createFormRef = useRef<HTMLDivElement>(null);

  // Derived: does the current query look like a document number?
  const isQueryNumeric = /^\d+$/.test(query.trim());

  // Search effect
  useEffect(() => {
    let cancelled = false;
    const trimmed = query.trim();

    if (!trimmed && !isOpen) {
      setResults([]);
      return;
    }

    setIsLoading(true);
    clientsService
      .search(trimmed || undefined)
      .then((items) => {
        if (!cancelled) {
          setResults(items);
          setIsLoading(false);
          setFocusedIndex(-1);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResults([]);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [query, clientsService, isOpen]);

  const handleSelect = useCallback(
    (client: ClientSearchResult) => {
      onSelectClient({
        id: client.id,
        name: client.fullName,
        identification: `${client.identificationType}: ${client.identificationNumber}`,
      });
      setIsOpen(false);
      setQuery("");
      setResults([]);
    },
    [onSelectClient],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setFocusedIndex((prev) =>
          prev < results.length - 1 ? prev + 1 : 0,
        );
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setFocusedIndex((prev) =>
          prev > 0 ? prev - 1 : results.length - 1,
        );
      } else if (event.key === "Enter" && focusedIndex >= 0) {
        event.preventDefault();
        handleSelect(results[focusedIndex]);
      } else if (event.key === "Escape") {
        if (showCreateForm) {
          setShowCreateForm(false);
          setCreateError(null);
        } else {
          setIsOpen(false);
          setQuery("");
          setResults([]);
        }
      }
    },
    [results, focusedIndex, handleSelect, showCreateForm],
  );

  /** Open the quick-create form, pre-filling fields from the search query. */
  const handleStartCreate = useCallback(() => {
    const trimmed = query.trim();
    setCreateFormData({
      fullName: isQueryNumeric ? "" : trimmed,
      identificationType: "CC",
      identificationNumber: isQueryNumeric ? trimmed : "",
      email: "",
      phone: "",
      address: "",
      municipality: "",
      department: "",
    });
    setCreateError(null);
    setShowCreateForm(true);
    // Small delay so the DOM renders before focusing the first input
    setTimeout(() => {
      createFormRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    }, 50);
  }, [query, isQueryNumeric]);

  /** Submit the quick-create form, then auto-select the new client. */
  const handleSubmitCreate = useCallback(async () => {
    if (!onCreateClient) return;
    const trimmed = createFormData.fullName.trim();
    if (!trimmed || !createFormData.identificationNumber.trim()) return;

    setIsCreating(true);
    setCreateError(null);
    try {
      await onCreateClient(createFormData);
      // The hook already dispatches setClient, so we just close the form
      setShowCreateForm(false);
      setIsOpen(false);
      setQuery("");
      setResults([]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setCreateError(message);
    } finally {
      setIsCreating(false);
    }
  }, [onCreateClient, createFormData]);

  // If a client is already selected, show the selected chip
  if (selectedClient) {
    return (
      <div
        className="flex items-center justify-between rounded-pos border px-pos-md py-pos-sm"
        style={{
          borderColor:
            clientRequirement === "REQUIRED"
              ? "var(--color-pharma)"
              : "color-mix(in srgb, var(--color-ink) 15%, transparent)",
          backgroundColor:
            clientRequirement === "REQUIRED"
              ? "color-mix(in srgb, var(--color-pharma) 5%, white)"
              : "var(--color-panel)",
        }}
      >
        <div className="flex items-center gap-pos-sm">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0"
            style={{ color: "var(--color-pharma)" }}
            aria-hidden="true"
          >
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <div className="min-w-0">
            <p
              className="truncate text-body-sm font-medium"
              style={{ color: "var(--color-ink)" }}
            >
              {selectedClient.name}
            </p>
            <p
              className="truncate text-caption"
              style={{
                color:
                  "color-mix(in srgb, var(--color-ink) 60%, transparent)",
              }}
            >
              {selectedClient.identification}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClearClient}
          className="shrink-0 rounded p-1 transition-colors hover:bg-ink/5"
          aria-label={t("sales.client.clear")}
          title={t("sales.client.change")}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
    );
  }

  // No client selected — show search when open, or prompt button when collapsed
  return (
    <div className="relative">
      {isOpen ? (
        <div className="relative">
          <div className="relative">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
              style={{
                color:
                  "color-mix(in srgb, var(--color-ink) 40%, transparent)",
              }}
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                // Keep dropdown open while the create form is showing
                setTimeout(() => {
                  if (!showCreateForm) setIsOpen(false);
                }, 200);
              }}
              placeholder={t("sales.client.search_placeholder")}
              aria-label={t("sales.client.search_placeholder")}
              className="pos-input w-full pl-8"
              autoFocus
            />
          </div>

          {/* Results dropdown */}
          {results.length > 0 && (
            <div
              ref={listRef}
              role="listbox"
              aria-label={t("sales.client.label")}
              className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-pos border bg-panel shadow-pos"
              style={{
                borderColor:
                  "color-mix(in srgb, var(--color-ink) 12%, transparent)",
              }}
            >
              {/* Create-new-client at TOP — always visible first */}
              {onCreateClient && (
                <>
                  <button
                    type="button"
                    onMouseDown={handleStartCreate}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-body-sm font-semibold transition-colors hover:bg-pharma/5 sticky top-0 z-10"
                    style={{
                      color: "var(--color-pharma)",
                      backgroundColor: "var(--color-panel)",
                      borderBottom:
                        results.length > 0
                          ? "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)"
                          : undefined,
                    }}
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 5v14" />
                      <path d="M5 12h14" />
                    </svg>
                    <span>
                      {t("sales.client.create_new", { query: query.trim() })}
                    </span>
                  </button>
                </>
              )}

              {results.map((client, index) => (
                <button
                  key={client.id}
                  type="button"
                  role="option"
                  aria-selected={index === focusedIndex}
                  onMouseDown={() => handleSelect(client)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left text-body-sm transition-colors ${
                    index === focusedIndex ? "bg-pharma/5" : ""
                  } hover:bg-pharma/5`}
                  style={{
                    backgroundColor:
                      index === focusedIndex
                        ? "color-mix(in srgb, var(--color-pharma) 8%, white)"
                        : undefined,
                    color: "var(--color-ink)",
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0"
                    style={{
                      color:
                        "color-mix(in srgb, var(--color-ink) 40%, transparent)",
                    }}
                    aria-hidden="true"
                  >
                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  <div className="min-w-0 flex-1">
                    <span className="truncate font-medium">
                      {client.fullName}
                    </span>
                    <span
                      className="ml-2 truncate text-caption"
                      style={{
                        color:
                          "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                      }}
                    >
                      {client.identificationType}:{" "}
                      {client.identificationNumber}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Empty state — offer creation when onCreateClient is available */}
          {query.trim() && !isLoading && results.length === 0 && (
            <div
              className="absolute left-0 right-0 top-full z-30 mt-1 rounded-pos border bg-panel shadow-pos"
              style={{
                borderColor:
                  "color-mix(in srgb, var(--color-ink) 12%, transparent)",
              }}
            >
              {onCreateClient ? (
                <div className="flex flex-col">
                  <p
                    className="px-3 py-2 text-body-sm"
                    style={{
                      color:
                        "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                    }}
                  >
                    {t("sales.client.no_results")}
                  </p>
                  <button
                    type="button"
                    onMouseDown={handleStartCreate}
                    className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-body-sm font-medium transition-colors hover:bg-pharma/5"
                    style={{
                      borderColor:
                        "color-mix(in srgb, var(--color-ink) 8%, transparent)",
                      color: "var(--color-pharma)",
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 5v14" />
                      <path d="M5 12h14" />
                    </svg>
                    <span>
                      {t("sales.client.create_new", { query: query.trim() })}
                    </span>
                  </button>
                </div>
              ) : (
                <p
                  className="px-3 py-2 text-body-sm"
                  style={{
                    color:
                      "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                  }}
                >
                  {t("sales.client.no_results")}
                </p>
              )}
            </div>
          )}

          {isLoading && (
            <div
              className="absolute left-0 right-0 top-full z-30 mt-1 rounded-pos border bg-panel px-3 py-2 text-body-sm shadow-pos"
              style={{
                borderColor:
                  "color-mix(in srgb, var(--color-ink) 12%, transparent)",
                color:
                  "color-mix(in srgb, var(--color-ink) 50%, transparent)",
              }}
            >
              {t("common.loading")}
            </div>
          )}

          {/* Quick-create form */}
          {showCreateForm && onCreateClient && (
            <div
              ref={createFormRef}
              className="absolute left-0 right-0 top-full z-40 mt-1 rounded-pos border bg-panel shadow-pos-lg"
              style={{
                borderColor:
                  "color-mix(in srgb, var(--color-ink) 12%, transparent)",
              }}
            >
              <QuickClientForm
                data={createFormData}
                onChange={setCreateFormData}
                onSubmit={handleSubmitCreate}
                onCancel={() => { setShowCreateForm(false); setCreateError(null); }}
                isSubmitting={isCreating}
                error={createError}
              />
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setIsOpen(true);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
          className={`flex w-full items-center gap-2 rounded-pos border border-dashed px-pos-md py-pos-sm text-body-sm transition-colors hover:bg-ink/5 ${
            clientRequirement === "REQUIRED"
              ? "border-pharma/40 text-pharma"
              : ""
          }`}
          style={{
            borderColor:
              clientRequirement === "REQUIRED"
                ? "color-mix(in srgb, var(--color-pharma) 40%, transparent)"
                : "color-mix(in srgb, var(--color-ink) 20%, transparent)",
            color:
              clientRequirement === "REQUIRED"
                ? "var(--color-pharma)"
                : "color-mix(in srgb, var(--color-ink) 60%, transparent)",
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <span>
            {clientRequirement === "REQUIRED"
              ? t("sales.client.required")
              : t("sales.client.optional")}
          </span>
        </button>
      )}
    </div>
  );
};
