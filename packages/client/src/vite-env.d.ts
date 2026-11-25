/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Game server base URL, e.g. https://hellovalley-server.fly.dev. Defaults to the local dev server. */
  readonly VITE_SERVER_URL?: string;
}
