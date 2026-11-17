import { studioHost } from "./api"

/** Account access ships on the separate studio-auth branch. */
export const AUTH_ENABLED = false

/** A GitHub Pages build can connect to the configured hosted backend. */
export const STATIC_SITE = !studioHost()
export const REPOSITORY = "https://github.com/TanishC4444/ParaMyth"
