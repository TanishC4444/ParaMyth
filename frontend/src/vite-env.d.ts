/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" in the GitHub Pages build, which has no studio server. */
  readonly VITE_STATIC_SITE?: string
}
