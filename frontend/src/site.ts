import { studioHost } from "./api"

/** Controls the optional landing-page sign-in shortcut; studio authentication remains available in production. */
export const AUTH_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_AUTH === "true"

/** A GitHub Pages build can connect to the configured hosted backend. */
export const STATIC_SITE = !studioHost()
export const REPOSITORY = "https://github.com/TanishC4444/ParaMyth"
