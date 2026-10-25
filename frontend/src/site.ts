import { studioHost } from "./api"

/** The public website has no studio server behind it; the studio only answers on loopback. */
export const STATIC_SITE = !studioHost()
export const REPOSITORY = "https://github.com/TanishC4444/ParaMyth"
