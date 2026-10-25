import { useEffect, useState } from "react";
import { Wordmark } from "./brand";
import { REPOSITORY } from "./site";
import { ArtCredits } from "./art";
import "./night.css";
import "./legal.css";

import { SiteLinks } from "./SiteLinks";
const titles: Record<string, string> = { terms: "Terms of Use", privacy: "Privacy & Storage", contact: "Contact & Support", accessibility: "Accessibility", credits: "Copyright & Credits" };
export default function Legal() {
  const [route, setRoute] = useState(() => location.hash.replace(/^#\/?/, "").split("/")[0]);
  useEffect(() => { const update = () => setRoute(location.hash.replace(/^#\/?/, "").split("/")[0]); window.addEventListener("hashchange", update); return () => window.removeEventListener("hashchange", update); }, []);
  const title = titles[route] || titles.contact;
  useEffect(() => { const previous = document.title; document.title = `${title} · ParaMyth`; window.scrollTo({ top: 0, behavior: "instant" }); document.getElementById("legal-main")?.focus({ preventScroll: true }); return () => { document.title = previous; }; }, [title]);
  return <div className="night-page legal-page">
    <header className="pm-bar"><Wordmark /><a className="legal-back" href="#/">Back to ParaMyth</a></header>
    <main id="legal-main" className="legal-main" tabIndex={-1}><h1>{title}</h1>
      {route === "terms" && <>
        <p>ParaMyth helps creative directors and storytellers brainstorm, explore source stories, and develop rough drafts and production ideas.</p>
        <h2>Using ParaMyth</h2><p>Use the website and Studio lawfully. Do not upload material you are not entitled to use, interfere with other people’s access, or use the tools to violate someone’s rights. You are responsible for the material you submit and for how you use the results.</p>
        <h2>Drafts, research, and generated material</h2><p>Story summaries and creative suggestions are starting points for development. They may contain errors, omissions, or similarities to existing work. Check facts, cultural context, permissions, and suitability before production or publication. ParaMyth does not guarantee accuracy, originality, exclusivity, or clearance.</p>
        <h2>Your work and source material</h2><p>ParaMyth does not claim ownership of your original submissions. These terms do not give you rights in someone else’s work. Classic stories, translations, illustrations, recordings, and modern adaptations can have different rights; check the specific source and intended use.</p>
        <h2>Studio and connected services</h2><p>The public website provides the Atlas and product information. The Studio runs on a separately configured server. Model, image, audio, storage, and other connected services have their own terms and may charge for usage. Configure them deliberately and keep credentials private.</p>
        <h2>Availability and changes</h2><p>The tools are provided as available, without a promise of uninterrupted service or fitness for a particular production. Keep your own backups. Nothing here excludes rights or remedies that cannot lawfully be excluded. These terms may change as the product develops; material changes will be reflected on this page.</p>
        <p>Questions about these terms can be raised through <a href="#/contact">Contact & Support</a>.</p>
      </>}
      {route === "privacy" && <>
        <p>This notice describes the public website and distinguishes it from a separately hosted ParaMyth Studio.</p>
        <h2>The public website</h2><p>Browsing the bundled Story Atlas does not require an account. Fonts, artwork, Earth textures, and the story corpus are served with the site. The current website does not include advertising or third-party analytics scripts.</p>
        <h2>Browser storage</h2><p>Session storage remembers your Book or Atlas view and book position. The Studio also uses browser storage for preferences and pending draft recovery. These are functional records, not advertising profiles. You can remove them using your browser’s site-data controls; doing so may erase local preferences or unsaved drafts.</p>
        <h2>Hosting and external links</h2><p>The public site is hosted on GitHub Pages. Hosting infrastructure can process connection information, including IP addresses and request details. See <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noreferrer">GitHub’s privacy statement</a>. Following an external source or support link takes you to that service, whose privacy practices apply.</p>
        <h2>Your Studio configuration</h2><p>A Studio server can store account details, projects, drafts, and generated assets. Prompts or files may be sent to the providers configured for a requested task. Retention and access depend on the server and provider configuration. Do not assume client briefs or unpublished material remain on your device when using connected services.</p>
        <h2>Requests and sensitive information</h2><p>For an account, correction, deletion, privacy, or retention request, contact the operator of your Studio deployment. For this website, use <a href="#/contact">Contact & Support</a>. Public issues are visible to others: never include passwords, API keys, personal information, or confidential creative work.</p>
      </>}
      {route === "contact" && <>
        <p>For product questions, feedback, accessibility problems, or a broken page, reach the ParaMyth project maintainers through the repository.</p>
        <a className="legal-action" href={`${REPOSITORY}/issues/new`} target="_blank" rel="noreferrer">Open a Support Request ↗</a>
        <h2>What to include</h2><p>Describe the page, the action you took, what you expected, and your browser or device. Remove private information from screenshots and logs before sharing them.</p>
        <h2>Privacy, copyright, or security concerns</h2><p>Support issues are public. For a private concern, use a private contact method published on the <a href="https://github.com/TanishC4444" target="_blank" rel="noreferrer">maintainer’s profile</a> or, for a Studio account, contact that deployment’s operator. Do not post sensitive details publicly. The repository’s <a href={`${REPOSITORY}/security/policy`} target="_blank" rel="noreferrer">Security page</a> lists any available disclosure instructions.</p>
        <h2>Project details</h2><p>ParaMyth is maintained in the <a href={REPOSITORY} target="_blank" rel="noreferrer">ParaMyth repository</a>. A dedicated support email and separate legal company identity have not been published here.</p>
      </>}
      {route === "accessibility" && <>
        <p>ParaMyth is designed for keyboard navigation and responsive screens. Accessibility work is ongoing; this is not a claim of certification.</p>
        <h2>Motion and navigation</h2><p>The Book follows your scrolling and can be navigated with its scene buttons. Use Story Atlas to skip directly to the stories. Reduce Motion is available in the footer; system motion preferences are respected too.</p>
        <h2>Using the Atlas without dragging</h2><p>Search by story or place, use the story list, or switch to the flat map. The globe supports arrow keys, plus and minus to zoom, and Home to reset. Story selection is available through labeled buttons.</p>
        <h2>Report a barrier</h2><p>If a control, animation, text layout, or assistive-technology interaction prevents you from using the site, <a href="#/contact">send a support request</a> with the browser and accessibility tools you use.</p>
      </>}
      {route === "credits" && <>
        <p>The book and gallery feature illustrations of classic stories, including the Ramayana, Shahnameh, The Faerie Queene, and illustrated fairy tales. Source records identify each artwork and its rights statement.</p>
        <h2>Artwork and adaptations</h2><p>Selected museum images are provided under CC0, and other illustrations are identified as public domain by their source. These labels apply to the listed assets, not every edition or adaptation of the story. See the <a href="https://creativecommons.org/public-domain/" target="_blank" rel="noreferrer">Creative Commons explanation of public-domain tools</a>.</p><ArtCredits />
        <h2>Other credits</h2><p>Earth imagery: NASA and Three Globe. Map data: Natural Earth. Type: Bodoni Moda and Manrope, with font licenses included in the source distribution. Software dependencies retain their respective licenses.</p>
        <h2>Corrections and rights requests</h2><p>If a source, attribution, or rights statement needs correction, use <a href="#/contact">Contact & Support</a> and identify the artwork and source record. ParaMyth’s name and original interface do not change ownership of the underlying works.</p>
      </>}
    </main><footer className="legal-footer"><SiteLinks /><small>ParaMyth · Story development tools</small></footer>
  </div>;
}
