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
