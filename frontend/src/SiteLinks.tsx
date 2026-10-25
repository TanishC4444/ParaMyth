import { REPOSITORY } from "./site";
import { LEGAL_ROUTES } from "./legal-routes";
const titles: Record<string, string> = { terms: "Terms of Use", privacy: "Privacy & Storage", contact: "Contact & Support", accessibility: "Accessibility", credits: "Copyright & Credits" };
export function SiteLinks() {
  return <nav className="site-links" aria-label="Site information">{LEGAL_ROUTES.map(route => <a key={route} href={`#/${route}`}>{titles[route]}</a>)}<a href={`${REPOSITORY}/issues`} target="_blank" rel="noreferrer">Report an Issue ↗</a></nav>;
}
