// Shared import contract: column metadata and row-level issue types used by
// both the server import module and the POS desktop local import flow, so a
// CSV column means the same thing on every side of the sync boundary.

export interface ImportColumnMeta {
  /** Canonical field key, also used as the default header in templates. */
  key: string;
  /** Human-readable column name shown in templates and previews. */
  label: string;
  /** Accepted header variants (compared lowercased and trimmed). */
  aliases: string[];
  required: boolean;
  description: string;
}

export interface ImportIssue {
  /** Field key or 'row' when the issue spans the whole row. */
  path: string;
  message: string;
}