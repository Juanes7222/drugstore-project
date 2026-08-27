/**
 * Linked department → municipality fields backed by the static DIVIPOLA
 * catalog. Both are filterable comboboxes (type to narrow the list), the
 * municipality stays disabled until a department is chosen, and switching
 * departments clears a municipality that no longer belongs.
 */
import { type FC, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BuildingIcon } from "@/components/ui/icons";
import { SearchableSelect, type SearchableSelectOption } from "@/components/purchases/searchable-select";
import { COLOMBIA_DEPARTMENTS, findDepartmentByName } from "@/utils/colombia-geo";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DepartmentMunicipalityFieldsProps {
  /** Persisted department display name; empty string = nothing selected. */
  department: string;
  /** Persisted municipality display name; empty string = nothing selected. */
  municipality: string;
  onDepartmentChange: (department: string) => void;
  onMunicipalityChange: (municipality: string) => void;
  disabled?: boolean;
  /** Compact sizing for inline forms (quick-create during a sale). */
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const LABEL_CLASS = "mb-1 block text-caption font-medium";
const COMPACT_LABEL_CLASS = "mb-0.5 block text-caption";
const COMPACT_INPUT_CLASS = "px-2 py-1 text-body";

// ---------------------------------------------------------------------------
// Filtering — accent-insensitive so "medellin" finds "Medellín"
// ---------------------------------------------------------------------------

function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CO");
}

function filterByName(options: readonly SearchableSelectOption[], query: string): SearchableSelectOption[] {
  const needle = normalizeForSearch(query.trim());
  if (!needle) return [...options];
  const startsWith: SearchableSelectOption[] = [];
  const contains: SearchableSelectOption[] = [];
  for (const option of options) {
    const haystack = normalizeForSearch(option.label);
    if (haystack.startsWith(needle)) startsWith.push(option);
    else if (haystack.includes(needle)) contains.push(option);
  }
  return [...startsWith, ...contains];
}

/** Wrap catalog names as combobox options, keeping legacy free-text values visible. */
function toOptions(names: readonly { code: string; name: string }[], legacyValue: string): SearchableSelectOption[] {
  const options: SearchableSelectOption[] = names.map((entry) => ({
    id: entry.name,
    label: entry.name,
  }));
  if (
    legacyValue &&
    !options.some((option) => option.id === legacyValue)
  ) {
    // Records created before the catalog existed may hold free-text values;
    // append them so editing never silently drops what was saved. The id
    // mirrors the value so SearchableSelect can resolve the shown label.
    options.push({ id: legacyValue, label: legacyValue });
  }
  return options;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const DepartmentMunicipalityFields: FC<DepartmentMunicipalityFieldsProps> = ({
  department,
  municipality,
  onDepartmentChange,
  onMunicipalityChange,
  disabled = false,
  compact = false,
}) => {
  const { t } = useTranslation();
  const [departmentQuery, setDepartmentQuery] = useState("");
  const [municipalityQuery, setMunicipalityQuery] = useState("");

  const selectedDepartment = useMemo(
    () => (department ? findDepartmentByName(department) : undefined),
    [department],
  );

  const departmentOptions = useMemo(
    () => toOptions(COLOMBIA_DEPARTMENTS, department),
    [department],
  );
  const visibleDepartments = useMemo(
    () => filterByName(departmentOptions, departmentQuery),
    [departmentOptions, departmentQuery],
  );

  const municipalityBase = useMemo(
    () => toOptions(selectedDepartment?.municipalities ?? [], municipality),
    [selectedDepartment, municipality],
  );
  const visibleMunicipalities = useMemo(
    () => filterByName(municipalityBase, municipalityQuery),
    [municipalityBase, municipalityQuery],
  );

  const handleDepartmentSelect = useCallback(
    (option: SearchableSelectOption) => {
      onDepartmentChange(option.label);
      setDepartmentQuery("");
      // Selecting a legacy free-text department keeps the municipality as-is;
      // there is no catalog entry to validate it against.
      const nextList = findDepartmentByName(option.label)?.municipalities;
      if (!nextList) return;
      if (!nextList.some((entry) => entry.name === municipality)) {
        onMunicipalityChange("");
      }
      setMunicipalityQuery("");
    },
    [onDepartmentChange, onMunicipalityChange, municipality],
  );

  const handleMunicipalitySelect = useCallback(
    (option: SearchableSelectOption) => {
      onMunicipalityChange(option.label);
      setMunicipalityQuery("");
    },
    [onMunicipalityChange],
  );

  const labelClass = compact ? COMPACT_LABEL_CLASS : LABEL_CLASS;
  const labelColor = compact
    ? "color-mix(in srgb, var(--color-ink) 60%, transparent)"
    : "var(--color-ink-muted)";
  const inputClassName = compact ? COMPACT_INPUT_CLASS : undefined;

  return (
    <>
      <div>
        <label className={labelClass} style={{ color: labelColor }}>
          <span className="inline-flex items-center gap-1">
            <BuildingIcon className="size-4 opacity-60" />
            {t("clients.department")}
          </span>
        </label>
        <SearchableSelect
          options={visibleDepartments}
          onSearch={setDepartmentQuery}
          onSelect={handleDepartmentSelect}
          selectedId={department || null}
          placeholder={t("clients.select_department")}
          ariaLabel={t("clients.department")}
          inputClassName={inputClassName}
          disabled={disabled}
        />
      </div>

      <div>
        <label className={labelClass} style={{ color: labelColor }}>
          <span className="inline-flex items-center gap-1">
            <BuildingIcon className="size-4 opacity-60" />
            {t("clients.municipality")}
            {!selectedDepartment && (
              <span
                id="municipality-needs-department"
                className="text-xs"
                style={{ color: "var(--color-ink-muted)" }}
              >
                ({t("clients.municipality_needs_department")})
              </span>
            )}
          </span>
        </label>
        <SearchableSelect
          options={visibleMunicipalities}
          onSearch={setMunicipalityQuery}
          onSelect={handleMunicipalitySelect}
          selectedId={municipality || null}
          placeholder={t("clients.select_municipality")}
          ariaLabel={t("clients.municipality")}
          inputClassName={inputClassName}
          disabled={disabled || !selectedDepartment}
        />
      </div>
    </>
  );
};
