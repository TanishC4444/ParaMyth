# paramyth.tech QA and redesign

A full pass over the public site (the `frontend/` build that GitHub Pages serves at
paramyth.tech), checked at desktop (1024px) and phone (375px) widths, with motion on
and reduced. Every finding below is either fixed in this change or listed under
"Still open".

## Broken on the live site

| # | Finding | Fix |
|---|---|---|
| 1 | "Sign in / Join" opened `/studio/teams.html`, a GitHub Pages 404. | Static builds hide it. Sign-in only appears where a studio server exists. |
| 2 | "Your stories" and "Open studio" opened the studio, which showed "Live studio request failed (404). Check Connections." under a "LIVE STUDIO · SAVED TO YOUR WORKSPACE" badge. Both claims were false on a static host. | Static builds (`VITE_STATIC_SITE=1`, set in `website.yml`) replace studio routes with a page that explains the studio runs locally and gives the four setup commands. |
| 3 | Every page load fired `/api/ui/workspace`, `/api/ui/retrieval-connection` and `/api/v1/atlas/stories`, all 404s. | Static builds make no API calls. The atlas uses its bundled corpus directly. |
| 4 | "Find inspiration", "Ideate on this story", "Draw inspiration" and "Pin" all needed the API and failed silently on Pages. | Static builds hide the idea search and replace story actions with a short note linking to studio setup. |
| 5 | During the scroll hand-off the atlas heading, buttons and globe were visible through the intro title, and "Skip intro / Pause" overlapped "Revisit the introduction / Reduce motion". Cause: Anime.js only writes a tween's start value once the tween begins, so the atlas sat at full opacity before its fade. | The atlas is held at opacity 0 by CSS until the hand-off phase. Controls, rail and scroll cue hide before the atlas appears. |
| 6 | Phone: the story list was a 560px box scrolling inside the page (two scroll areas fighting) followed by a dead gap. | One column now scrolls with the page, and phones show 12 stories per page instead of 80. |

## Looked machine-made

| # | Finding | Fix |
|---|---|---|
| 7 | Favicon was Figma Make's default sparkle icon. | New compass-rose favicon in the brand colors. |
| 8 | Header logo was a 1280×720 raster badge with a baked-in background, so it sat on the page like a sticker. | Typeset wordmark (Para*Myth*) with a stroked compass emblem, drawn in SVG. |
| 9 | Type was Georgia italic for display and Manrope for everything else: the default pairing of countless templates. | Fraunces (variable, optical sizes) for display and Instrument Sans for interface text. |
| 10 | Generic copy: "A little wonder. A world of possibility.", "Watch the pages. Then follow the story.", "01 / THE BEGINNING". | Concrete copy tied to the corpus: "385 tales · 11 traditions · one atlas", chapter rail "The opening / The name / The atlas". |
| 11 | The book opened onto the same picture on both pages, then repeated it. | Each spread now pairs a typeset page (drop cap, real tales and places from the corpus) with a different plate. The cover opens onto an ex libris page. |
| 12 | Particles were evenly colored dots rising in columns. | Gilt, verdigris and vermilion motes that join into short engraved strokes as they form the name. |
| 13 | Two decorative ellipses ("orbits") with no meaning. | An engraved astrolabe dial carrying the eleven tradition names, turning with the scroll. |
| 14 | The dark, moody intro cut to a light grey SaaS layout (white cards, pill buttons, a grey disabled button) for the atlas. The page looked like two different products. | One night palette from the first frame to the footer: gilt rules, notched "plate" buttons, a ledger-style story panel, a scrolling ribbon of tradition names. |
| 15 | The background faded from teal to cream through a full-screen colour tween. | The intro's atmosphere fades out over the same night backdrop, so there is no seam. |
| 16 | Footer: one tagline, a credits toggle and a link. | A colophon with the brand line, studio setup steps (static builds), sources and credits. |

## Polish

| # | Finding | Fix |
|---|---|---|
| 17 | Header scrolled away, so `#/atlas` deep links had no navigation. | Fixed header that turns to frosted glass once the atlas is reached. |
| 18 | Zooming the globe showed a hard rectangular crop at the canvas edges. | Canvas edges are feathered with a mask. |
| 19 | The story detail panel was taller than the viewport, so its text was cut off. | Panel height follows the viewport. |
| 20 | Reduced-motion mode overlapped the atlas onto the book (a margin reset lost to a later rule). | Fixed and checked. Manual "Reduce motion" also stops the ribbon. |
| 21 | Page title and meta description described the studio, not the site. | "ParaMyth · A world of stories" and a description of the atlas. |
| 22 | Studio stylesheet styles every `<header>` white; it leaked into new pages. | The night bar opts out explicitly. |
| 23 | Unknown `#/` routes silently showed the landing; a failed page chunk left a blank screen. | A 404 page, an error page with reload (and one automatic reload after a redeploy), and branded loading states. |
| 24 | A white flash before the app loaded, nothing for visitors without JavaScript, no share previews, icons, manifest, robots or sitemap. | Night boot screen in `index.html`, a `noscript` message, Open Graph and Twitter tags, app icons, `site.webmanifest`, `robots.txt` and `sitemap.xml`. |

## Load and runtime cost

| | Before | After |
|---|---|---|
| First load (own files + fonts) | about 3.6 MB | about 475 KB (300 KB own files gzip, about 175 KB fonts) |
| Logo | 604 KB PNG, fetched twice | SVG wordmark on the landing; 11 KB WebP in the studio sidebar, lazy |
| Book illustrations | 1.4 MB (full-size scans) | 180 KB (720px copies in `public/art/book/`; originals unchanged) |
| Globe code and geometry | loaded with the landing | about 810 KB gzip, loaded when the reader nears the atlas or the page goes idle |
| Studio pages | all bundled into the main script | each loaded on first visit |
| Fonts | CSS `@import` (render-blocking chain) | `<link>` with preconnect |
| Per-frame work | full-screen blurred layer with an animated background colour; two full-screen blend-mode overlays | transforms and opacity only, one capped 30 fps canvas, no per-frame filters or blend modes |

## Still open

- Frame timing was not measured on a real device; the browser pane was hidden during testing, which throttles animation frames. Check with a performance trace on a mid-range phone.
- The studio itself (overview, projects, workflow and the other tool pages) keeps its existing light design. A matching studio pass is separate work.
- The globe's map texture is a bright political map. It reads well on the night palette, but a muted, toned texture would sit better.
