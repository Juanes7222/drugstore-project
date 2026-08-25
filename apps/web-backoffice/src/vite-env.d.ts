/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** Public marketing site origin; the signup/checkout flow lives there. */
  readonly VITE_LANDING_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
