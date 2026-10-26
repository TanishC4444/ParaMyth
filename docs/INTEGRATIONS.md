# Provider integrations

[Back to the project](../README.md) · [Architecture](ARCHITECTURE.md)

## HackTX 2026: implementation highlights

The order below leads with the social creative experience and the integrations that make the most visible, demonstrable contributions to it. Each section links to implementation evidence.

### 1. Meta: a shared visual language for creative collaboration

**Challenge alignment: Bringing People Closer Together with AI.** ParaMyth gives people a shared space to develop stories, discuss ideas, and turn written descriptions into visual references they can understand and build on together.

- **Muse Image integration:** the main studio calls Meta's Responses API with `muse-image-1.0`, an `image_generation` tool request, PNG output, and `store: false`.
- **Narrative-conditioned prompts:** character, scene, location, prop, storyboard, and custom briefs draw on selected project writing and art direction. Optional text-model enhancement separates established descriptions from proposed visual choices.
- **Persistent visual artifacts:** generated files retain their prompt, provider/model, dimensions, status, and SHA-256 digest. Project media can also retain its writing-source identity and signature.
- **Team interpretation:** permissioned studios bring manuscripts, imagery, sound, and production materials into one shared workflow, with discussions and revision conflict handling.
- **Community Discovery:** creators explicitly publish project, story, or character snapshots. Posts support attribution, tags, search, editing, unpublishing, and reporting; publishing a snapshot is separate from exposing a private manuscript.

**Demo:** two creators develop one scene, generate its visual reference, discuss the result, and share an intentional snapshot with the community.

Implementation: [Meta generation](../paramyth/image_studio.py), [media source resolution](../paramyth/pipeline/media_workspace.py), [team workspaces](../paramyth/studio/team_workspace.py), [Discovery](../paramyth/studio/discovery.py).

### 2. SerpAPI: production intelligence connected to the real world

**Challenge alignment: Best Use of SerpApi.** ParaMyth translates fictional requirements into dated, regional research and practical production allowances using four search engines.

| Engine | Implementation in ParaMyth |
| --- | --- |
| `google` | Film offices, permit research, published rates, location discovery, documentary source leads. |
| `google_maps` | Catering, passenger transport, camera/lighting/sound suppliers, and nearby medical facilities. |
| `google_hotels` | Dated accommodation searches with room-night rates, amenities, ratings, and location information. |
| `google_flights` | Return-fare leads with airport/date parameters, itinerary information, and travel duration. |

The planner derives travel dates from the shoot schedule, estimates room counts from headcount, and turns structured hotel and flight results into explicit budget allowances. It retains alternatives rather than presenting one result's price as another result's offering.

Research runs through a shared adapter with engine-specific normalization, parameter allowlists, SQLite caching, per-plan and rolling daily limits, credential cooldowns, and ordered key failover. Evidence records preserve public links, retrieval times, and source IDs. Recommendations can cite only supplied IDs; published-rate extraction checks the quote, amount, currency, and billing unit before replacing an estimate.

The documentary workflow adds topic-specific searches for original records, archives, research, and current developments. Optional model synthesis produces a provisional angle, cited claims, timeline, interview questions, proposed sequences, archive leads, and verification tasks. Dossiers export to PDF and Word.

**Demo:** give a scene a real filming region and future shoot dates; inspect local suppliers, hotel/flight leads, the schedule, and the budget they inform. For documentary work, trace a provisional claim to its source lead.

Implementation: [search adapter](../paramyth/production_research.py), [production logistics](../paramyth/pipeline/production_operations.py), [price evidence](../paramyth/pipeline/production_intelligence.py), [documentary research](../paramyth/studio/research.py).

### 3. Northmark Compute & Cloud: reusable agent infrastructure

**Challenge alignment: Build the Platform Behind the Agent.** ParaMyth's advanced engine makes model setup, context assembly, role instructions, output contracts, monitoring, and recovery reusable across creative workflows.

- **A common role executor:** `Executor.call(role, packet, instruction, ...)` binds a stage to its context, model policy, output budget, schema, and validator.
- **Composable role responsibilities:** refinement, architecture, character proposals, direction, writing, editing, story/rhetoric review, memory extraction, and independent memory verification.
- **Scoped context construction:** character actors receive visible facts; role-specific literary and craft packets keep inputs relevant to the current task.
- **Policy-driven execution:** configurable hosted/CPU routes, bounded retries, concurrency controls, stage deadlines, model cooldowns, and provider request budgets.
- **Inspectable execution:** saved input packets, model outputs, timing/usage records, event timelines, checkpoints, and explicit failure reports.
- **Reusable workflow families:** sequential canon, parallel-scene reconciliation, living universes, continuation, and targeted recovery.
- **Distributed stages:** GitHub Actions dependencies and matrices execute role stages on separate runners and transfer versioned artifacts between them.

These capabilities form a reusable execution substrate: the same role interface and lifecycle support multiple story modes, model configurations, review policies, and recovery paths. Workflow authors define the intended creative process while the infrastructure handles the repeated mechanics of model invocation, state handoff, validation, and observability.

**Demo:** inspect a scene's role graph, open a scoped input packet, follow an evidence-linked review into a repair, and compare the provisional draft with the accepted checkpoint.

Implementation: [executor](../paramyth/pipeline/inference.py), [stage dispatcher](../paramyth/pipeline/dag.py), [character proposals](../paramyth/pipeline/character_proposals.py), [execution policies](../paramyth/pipeline/worker_policy.py), [workflow browser](../paramyth/pipeline/api/workflow_browser.py).

### 4. Gemini: semantic discovery and structured narrative intelligence

**Challenge alignment: Best Use of Gemini API.** Gemini powers both retrieval and configurable text-generation stages.

- **Literary embeddings:** `gemini-embedding-001` generates normalized 768-dimensional vectors with separate `RETRIEVAL_DOCUMENT` and `RETRIEVAL_QUERY` task types.
- **Hybrid retrieval:** NumPy cosine comparison combines with SQLite FTS5/BM25 keyword rankings. Advanced retrieval supports weighted query facets, narrative-mechanism overlap, explicit references, and source grouping.
- **Relevance explanations:** the hosted idea-search path can use a Gemini text model to rerank supplied candidate IDs and explain direct and related matches. Earlier retrieval results remain available if reranking fails.
- **Structured writing:** the interactive stream adapter supports Gemini JSON responses and schemas. Advanced model policies route writing, development, editing, review, and memory work to configured Google models.
- **Traceable retrieval:** encoder versions, corpus fingerprints, source IDs, and projection checks help prevent stale or incompatible reference material from silently entering a run.

Retrieved references become selected text and metadata in role packets. The interactive writer also builds continuity directly from saved project writing; retrieval is not automatically invoked for every chapter request.

Implementation: [embedding encoder](../paramyth/pipeline/rag/embeddings.py), [retrieval](../paramyth/pipeline/retrieval.py), [reranking](../paramyth/pipeline/rag/rerank.py), [stream adapter](../paramyth/pipeline/creative_stream.py), [Google routing](../docs/pipeline/google-routing.md).

### 5. Vultr: generation across writing, sound, and production

**Challenge alignment: Best Use of Vultr.** The integration uses Vultr Serverless Inference as a multimodal creative backend.

- **Creative text:** `muse-glimmer-30b` develops ideas, drafts chapters, reviews writing, and applies revisions through Chat Completions. The interactive provider selection prefers Vultr when its inference key is configured.
- **Production reasoning:** the same text integration extracts scene requirements and develops operational plans, resource estimates, location criteria, and research-backed recommendations.
- **Soundtracks:** music-model discovery and asynchronous music jobs support generation, capability checks, status tracking, playback, and downloads. Direction can be derived from selected writing or supplied explicitly.
- **Visual development:** text generation can enhance image prompts. The separate advanced image backend can discover Vultr image models and supports a recorded backup path after Meta failure; the main studio renderer uses the Meta-specific module.
- **Separated credentials:** dedicated production and music keys can be configured independently of the general inference key.

Local procedural ambience provides another audio path. Music duration, lyrics, and instrumental support are validated against the selected provider model's capabilities.

Implementation: [creative engine](../paramyth/pipeline/creative_studio.py), [production reasoning](../paramyth/pipeline/production.py), [music integration](../paramyth/pipeline/soundtracks.py), [advanced image backend](../paramyth/pipeline/image_studio.py).

### 6. Tiger Data: durable identity and permissioned creative teams

**Challenge alignment: Best Use of Tiger Data.** Tiger Cloud/PostgreSQL provides the relational foundation for accounts and studios through Psycopg.

- Users, salted scrypt password hashes, expiring/revocable sessions, persistent authentication throttling, studios, memberships, and invitations.
- Owner/admin/editor/viewer authorization enforced on server requests, plus project revision/comment tables used by collaboration APIs.
- Explicit, transactional migrations, a separate restricted runtime role, parameterized SQL, and certificate-verified TLS.
- A team runtime that shares project files and jobs while keeping each member's Calendar authorization and workspace selection personal.

The full creative workspace additionally persists manuscripts, drafts, media, and jobs on disk. Tiger holds identity and relational collaboration data; literary vectors and community Discovery use separate SQLite stores. Backups must include the database, workspace volume, and encryption key.

**Demo:** sign in as two members, open a shared project, observe saved changes, then compare editor and viewer permissions.

Implementation: [database and migrations](../paramyth/studio/studio_db.py), [sessions](../paramyth/studio/studio_security.py), [studio API](../paramyth/studio/studios.py), [database setup](../docs/TIGER.md).

### 7. .TECH and the infrastructure around the experience

**Additional challenge alignment: Best Domain from .TECH.** `paramyth.tech` gives the public creative studio a distinct project identity. GitHub Pages builds and publishes the frontend, Railway runs the documented FastAPI deployment with persistent storage, and Google Calendar OAuth connects a creator's schedule to their own account. These complement the generation providers with a navigable product, durable work, and practical exports.

The opening-ceremony deck limits entries to three tracks excluding Overall/Novice. For a focused judging narrative, lead with **Meta's collaborative creative experience**, **SerpAPI's production intelligence**, and **Northmark's reusable agent infrastructure**; the Gemini, Vultr, Tiger, and .TECH sections explain the additional engineering behind that demonstration. Confirm final submission selections against the event's current form.

