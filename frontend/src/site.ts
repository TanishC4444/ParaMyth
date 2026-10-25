import { studioHost } from "./api"

/** A GitHub Pages build can connect to the configured hosted backend. */
export const STATIC_SITE = !studioHost()
export const REPOSITORY = "https://github.com/TanishC4444/ParaMyth"
