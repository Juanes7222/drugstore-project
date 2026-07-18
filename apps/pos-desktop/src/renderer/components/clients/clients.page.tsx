/**
 * Clients page — search, view, and create clients.
 *
 * Thin wiring container that:
 * - Searches clients by document number or name
 * - Shows results in a table
 * - Inline create form for new clients (offline-first, syncs via queue)
 *
 * @category Page
 */
import {
  type FC,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useClientsService } from '../common/service-context';
import type { ClientSearchResult, CreateClientInput } from '../../../domain/clients/clients.service';
import { useLocalSessionStore } from '../../../domain/auth/local-session.store';

// ---------------------------------------------------------------------------
// Identification type labels (Colombian)
// ---------------------------------------------------------------------------
const ID_TYPES: { value: string; labelKey: string }[] = [
  { value: 'CC', labelKey: 'clients.id_type_cc' },
  { value: 'NIT', labelKey: 'clients.id_type_nit' },
  { value: 'CE', labelKey: 'clients.id_type_ce' },
  { value: 'PASSPORT', labelKey: 'clients.id_type_passport' },
  { value: 'TI', labelKey: 'clients.id_type_ti' },
  { value: 'PEP', labelKey: 'clients.id_type_pep' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ClientsPage: FC = () => {
  const { t } = useTranslation();
  const clientsService = useClientsService();
  const session = useLocalSessionStore((s) => s.session);
  const canCreate = !!session;

  // ---- Search state ----
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<ClientSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ---- Create form state ----
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState<CreateClientInput>({
    fullName: '',
    identificationType: 'CC',
    identificationNumber: '',
    email: '',
    phone: '',
    address: '',
    municipality: '',
    department: '',
  });
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // ---- Search ----
  const doSearch = useCallback(
    async (query: string) => {
      setIsSearching(true);
      try {
        const data = await clientsService.search(query || undefined);
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    },
    [clientsService],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void doSearch(searchQuery), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, doSearch]);

  // ---- Create ----
  const handleCreate = useCallback(async () => {
    if (!formData.fullName.trim() || !formData.identificationNumber.trim()) return;

    setIsCreating(true);
    setCreateError(null);

    try {
      await clientsService.create(formData);
      setShowCreateForm(false);
      setFormData({
        fullName: '',
        identificationType: 'CC',
        identificationNumber: '',
        email: '',
        phone: '',
        address: '',
        municipality: '',
        department: '',
      });
      // Refresh search to show new client
      void doSearch(searchQuery);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t('common.unexpected_error'));
    } finally {
      setIsCreating(false);
    }
  }, [formData, clientsService, doSearch, searchQuery, t]);

  // ---- Render ----
  return (
    <div className="flex h-full flex-col gap-pos-lg overflow-y-auto p-pos-xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="pos-page-title m-0">{t('clients.title')}</h1>
        {canCreate && !showCreateForm && (
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="pos-button pos-button-primary"
          >
            {t('clients.create')}
          </button>
        )}
      </div>

      {/* Search bar */}
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('clients.search_placeholder')}
          className="w-full rounded-pos border px-pos-sm py-pos-xs text-body outline-none"
          style={{
            borderColor: 'color-mix(in srgb, var(--color-ink) 15%, transparent)',
            backgroundColor: 'var(--color-surface)',
          }}
          autoFocus
        />
      </div>

      {/* Create form (inline) */}
      {showCreateForm && (
        <div
          className="rounded-pos p-pos-md"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-pharma) 4%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-pharma) 15%, transparent)',
          }}
        >
          <h3 className="mb-pos-md text-body font-semibold">{t('clients.create_title')}</h3>

          <div className="grid grid-cols-1 gap-pos-md sm:grid-cols-2">
            {/* Full name */}
            <div className="sm:col-span-2">
              <label className="mb-pos-xs block text-caption font-medium" style={{ color: 'var(--color-ink-muted)' }}>
                {t('clients.full_name')} *
              </label>
              <input
                type="text"
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                className="w-full rounded-pos border px-pos-sm py-pos-xs text-body outline-none"
                style={{ borderColor: 'color-mix(in srgb, var(--color-ink) 15%, transparent)', backgroundColor: 'var(--color-surface)' }}
              />
            </div>

            {/* ID type + number */}
            <div>
              <label className="mb-pos-xs block text-caption font-medium" style={{ color: 'var(--color-ink-muted)' }}>
                {t('clients.id_type')} *
              </label>
              <select
                value={formData.identificationType}
                onChange={(e) => setFormData({ ...formData, identificationType: e.target.value })}
                className="w-full rounded-pos border px-pos-sm py-pos-xs text-body outline-none"
                style={{ borderColor: 'color-mix(in srgb, var(--color-ink) 15%, transparent)', backgroundColor: 'var(--color-surface)' }}
              >
                {ID_TYPES.map((idType) => (
                  <option key={idType.value} value={idType.value}>{t(idType.labelKey)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-pos-xs block text-caption font-medium" style={{ color: 'var(--color-ink-muted)' }}>
                {t('clients.id_number')} *
              </label>
              <input
                type="text"
                value={formData.identificationNumber}
                onChange={(e) => setFormData({ ...formData, identificationNumber: e.target.value })}
                className="w-full rounded-pos border px-pos-sm py-pos-xs text-body outline-none"
                style={{ borderColor: 'color-mix(in srgb, var(--color-ink) 15%, transparent)', backgroundColor: 'var(--color-surface)' }}
              />
            </div>

            {/* Email + phone */}
            <div>
              <label className="mb-pos-xs block text-caption font-medium" style={{ color: 'var(--color-ink-muted)' }}>
                {t('clients.email')}
              </label>
              <input
                type="email"
                value={formData.email ?? ''}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full rounded-pos border px-pos-sm py-pos-xs text-body outline-none"
                style={{ borderColor: 'color-mix(in srgb, var(--color-ink) 15%, transparent)', backgroundColor: 'var(--color-surface)' }}
              />
            </div>
            <div>
              <label className="mb-pos-xs block text-caption font-medium" style={{ color: 'var(--color-ink-muted)' }}>
                {t('clients.phone')}
              </label>
              <input
                type="tel"
                value={formData.phone ?? ''}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full rounded-pos border px-pos-sm py-pos-xs text-body outline-none"
                style={{ borderColor: 'color-mix(in srgb, var(--color-ink) 15%, transparent)', backgroundColor: 'var(--color-surface)' }}
              />
            </div>

            {/* Address + municipality + department */}
            <div className="sm:col-span-2">
              <label className="mb-pos-xs block text-caption font-medium" style={{ color: 'var(--color-ink-muted)' }}>
                {t('clients.address')}
              </label>
              <input
                type="text"
                value={formData.address ?? ''}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="w-full rounded-pos border px-pos-sm py-pos-xs text-body outline-none"
                style={{ borderColor: 'color-mix(in srgb, var(--color-ink) 15%, transparent)', backgroundColor: 'var(--color-surface)' }}
              />
            </div>
            <div>
              <label className="mb-pos-xs block text-caption font-medium" style={{ color: 'var(--color-ink-muted)' }}>
                {t('clients.municipality')}
              </label>
              <input
                type="text"
                value={formData.municipality ?? ''}
                onChange={(e) => setFormData({ ...formData, municipality: e.target.value })}
                className="w-full rounded-pos border px-pos-sm py-pos-xs text-body outline-none"
                style={{ borderColor: 'color-mix(in srgb, var(--color-ink) 15%, transparent)', backgroundColor: 'var(--color-surface)' }}
              />
            </div>
            <div>
              <label className="mb-pos-xs block text-caption font-medium" style={{ color: 'var(--color-ink-muted)' }}>
                {t('clients.department')}
              </label>
              <input
                type="text"
                value={formData.department ?? ''}
                onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                className="w-full rounded-pos border px-pos-sm py-pos-xs text-body outline-none"
                style={{ borderColor: 'color-mix(in srgb, var(--color-ink) 15%, transparent)', backgroundColor: 'var(--color-surface)' }}
              />
            </div>
          </div>

          {createError && (
            <p className="mt-pos-md text-body-sm" style={{ color: 'var(--color-urgency)' }} role="alert">
              {createError}
            </p>
          )}

          <div className="mt-pos-md flex items-center justify-end gap-pos-sm">
            <button
              type="button"
              onClick={() => { setShowCreateForm(false); setCreateError(null); }}
              className="pos-button pos-button-secondary"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={isCreating || !formData.fullName.trim() || !formData.identificationNumber.trim()}
              className="pos-button pos-button-primary"
            >
              {isCreating ? t('common.loading') : t('clients.save')}
            </button>
          </div>
        </div>
      )}

      {/* Results table */}
      <div
        className="flex-1 overflow-auto rounded-pos"
        style={{ border: '1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)' }}
      >
        {isSearching ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-body-sm" style={{ color: 'var(--color-ink-muted)' }}>
              {t('common.loading')}
            </p>
          </div>
        ) : results.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-body-sm" style={{ color: 'var(--color-ink-muted)' }}>
              {searchQuery ? t('clients.no_results') : t('clients.type_to_search')}
            </p>
          </div>
        ) : (
          <table className="w-full border-collapse text-body-sm">
            <thead>
              <tr
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--color-ink) 4%, transparent)',
                  borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)',
                }}
              >
                <th className="px-pos-sm py-pos-xs text-left font-medium">{t('clients.full_name')}</th>
                <th className="px-pos-sm py-pos-xs text-left font-medium">{t('clients.document')}</th>
                <th className="px-pos-sm py-pos-xs text-left font-medium">{t('clients.email')}</th>
                <th className="px-pos-sm py-pos-xs text-left font-medium">{t('clients.phone')}</th>
                <th className="px-pos-sm py-pos-xs text-left font-medium">{t('clients.city')}</th>
              </tr>
            </thead>
            <tbody>
              {results.map((client, idx) => (
                <tr
                  key={client.id}
                  style={{
                    backgroundColor: idx % 2 === 0 ? 'transparent' : 'color-mix(in srgb, var(--color-ink) 2%, transparent)',
                    borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 4%, transparent)',
                  }}
                >
                  <td className="px-pos-sm py-pos-xs font-medium">{client.fullName}</td>
                  <td className="px-pos-sm py-pos-xs font-data tabular-nums">
                    <span
                      className="inline-flex items-center gap-1 rounded px-pos-xs py-0.5 text-caption"
                      style={{
                        backgroundColor: 'color-mix(in srgb, var(--color-ink) 6%, transparent)',
                      }}
                    >
                      {client.identificationType}
                    </span>
                    {' '}
                    {client.identificationNumber}
                  </td>
                  <td className="px-pos-sm py-pos-xs" style={{ color: 'var(--color-ink-muted)' }}>
                    {client.email ?? '—'}
                  </td>
                  <td className="px-pos-sm py-pos-xs" style={{ color: 'var(--color-ink-muted)' }}>
                    {client.phone ?? '—'}
                  </td>
                  <td className="px-pos-sm py-pos-xs" style={{ color: 'var(--color-ink-muted)' }}>
                    {[client.municipality, client.department].filter(Boolean).join(', ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
