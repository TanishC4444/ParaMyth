# paramyth.tech QA

Site-wide fixes that sit around the landing page, atlas and studio. Their designs
come from main unchanged; this work only adds pages and plumbing they don't cover.
Checked at desktop (1024px) and phone (375px) widths.

| # | Finding | Fix |
|---|---|---|
| 1 | Unknown `#/` routes silently showed the landing page. | A 404 page with links back to the landing and the atlas. |
| 2 | A page whose code failed to load (for example after a redeploy) left a blank screen. | An error page with reload, plus one automatic reload when a deploy replaced the page's code. |
| 3 | Studio pages on the public site only explained that each tool needs the local studio. | The public site shows one studio page with the four setup commands instead. |
| 4 | A blank page before the app loaded, and nothing at all without JavaScript. | A boot screen in the landing colours and a `noscript` message. |
| 5 | No share previews, home-screen icons, manifest, robots file or sitemap. Page title and description described the studio, not the site. | Open Graph and Twitter tags, app icons, `site.webmanifest`, `robots.txt`, `sitemap.xml`, and a title and description for the atlas. Path URLs such as `/atlas` now redirect to `#/atlas` through `404.html`. |
| 6 | The studio sidebar loaded a 604 KB PNG logo, and every studio page was bundled into the first script. | An 11 KB WebP logo, loaded lazily, and studio pages loaded on first visit. |

The public site is detected the same way as main's API guard: the studio only answers
on loopback, so any other host is the public site.

### Book, product information, and support revision

- Removed the opening border, corner frame, and slogan. Added a dedicated description of story development for creative directors between the book and Atlas.
- Slowed each scroll-controlled page turn from a 0.065 span of a 400vh track to 0.115 of an 800vh track. There is still no timed playback.
- Moved subdivided paper bending and its normals into the vertex shader. Capped pixel ratios, deferred the Atlas until the book's third scene, bounded texture uploads to two concurrent loads, and throttled globe DOM overlays independently from GPU movement.
- Book and gallery assets now come from named classic-story illustrations. Optimized variants retain the full source and rights metadata. The page library includes six Ramayana/Shahnameh additions.
- Aligned the book's collapse and horizon with the actual globe centre at each breakpoint. Shared scroll curves control the crossfade and globe scale.
- Added Terms, Privacy & Storage, Contact & Support, Accessibility, and Copyright & Credits routes. Support uses the official email, three owner-supplied team addresses, and the existing repository. A separate legal entity identity was not supplied. No compliance certification or private support channel is claimed.
- Loading, account connection errors, missing routes, stale chunks, and entry-module download failures have recovery actions. Physical-path 404 redirects also recognize legal destinations.
- Verified with TypeScript, production build, cinematic/Atlas behavior tests, legal-route tests, server rendering of all five information pages, and local asset/source checks.
- Added the supplied @paramythofficial embed to About, with lazy script loading, a reserved display area, and a permanent direct-profile fallback. The official email also appears in the footer.
- Browser access was disabled in Work settings during this revision. Visual layout, GPU execution, and measured frame rate could not be rechecked; source and server-render tests do not substitute for that check.

### About layout and visible book-to-world revision

- Root cause: the About/Instagram content was inside the fixed Atlas reveal and displaced the globe below the viewport. About and Atlas are now separate, normal-flow sections after the sticky animation.
- The book and an Earth mesh share one Three.js scene and camera. The book tilts and compresses into a horizon; an oblate Earth expands to a sphere in place. The final world stays visible while the sticky stage scrolls away. Scroll position alone controls the sequence, including reverse motion.
- The About section has a two-column introduction, three compact workflow items, and a full-width Instagram panel. The embed can use 900 px instead of 280 px on desktop, with natural document height instead of a fixed scrolling box.
- World texture loading starts before its reveal. Atlas initialization is deferred until the end of the book. The 3D preview skips identical frames while the user scrolls through later content.
- Added a structural server-render regression check to ensure About and Instagram cannot be nested inside the Atlas again, plus tests for the visible horizon/world phases.
- Local browser control remains disabled. TypeScript, build, behavior, and server-render checks verify the implementation; GPU appearance and responsive visual layouts still need a browser pass.

### Blend the book into About

- About overlaps the final viewport of the book timeline. A feathered edge and shared background replace the separate-screen handoff.
- The final scene fades as About, workflow text, and the Instagram panel are revealed by the same reversible scroll progress.
- The world reaches full size before the scene fades. Reduced-motion preferences suppress the text translation.
- Cinematic and structural tests, TypeScript, and the production build pass. Browser control remains disabled, so visual verification is still outstanding.
