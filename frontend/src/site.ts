import { studioHost } from "./api"

/** Authentication entry points are enabled during development and can be opted into for a hosted build. */
export const AUTH_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_AUTH === "true"

/** A GitHub Pages build can connect to the configured hosted backend. */
export const STATIC_SITE = !studioHost()
export const REPOSITORY = "https://github.com/TanishC4444/ParaMyth"
