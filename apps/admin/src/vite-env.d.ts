/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the API this panel talks to; the local API when unset. */
  readonly VITE_API_URL?: string;
}
