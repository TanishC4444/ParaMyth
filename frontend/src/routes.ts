import type { View } from "./types"
import { LEGAL_ROUTES } from "./legal-routes"
const VIEWS: View[] = [
  "workflow",
  "landing",
  "overview",
  "projects",
  "project",
  "atlas",
  "runs",
  "creative",
  "retrieval",
  "images",
  "music",
  "production",
  "library",
  "news",
  "connections",
  "discovery",
  "tutorials",
]
export const resolveRoute = (hash: string): View => {
  const v = hash.replace(/^#\/?/, "").split(/[/?]/)[0] as View
  if ((LEGAL_ROUTES as readonly string[]).includes(v)) return "legal"
  if (["creative", "images", "music", "production", "project"].includes(v)) return "workflow"
  if (VIEWS.includes(v)) return v
  // "#/something" is a route that does not exist; bare "#anchor" links stay on the landing.
  return hash.startsWith("#/") && v ? "notfound" : "landing"
}
