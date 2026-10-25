import { useEffect, useRef, useState } from "react"
import { api, currentAccountIdentity, currentWorkspaceIdentity } from "../api"
import { useStudio } from "../store"
import { errorText, PageTitle, fmtDate } from "../ui"
import { HelpTip } from "../Guide"

type Post = {
  id: string
  title: string
  body: string
  kind: string
  tags: string[]
  author_name: string
  mine: boolean
  published: boolean
  revision: number
  created_at: string
}
const empty = { kind: "project", title: "", body: "", tags: "" }
const draftKey=()=> 'paramyth-discovery-draft:'+currentAccountIdentity()
function savedDraft(){
  try{
    const value=JSON.parse(sessionStorage.getItem(draftKey()) || 'null')
    if(value && ['project','story','character'].includes(value.form?.kind) && ['title','body','tags'].every(key=>typeof value.form[key]==='string') && value.form.body.length<=12000)return value
  }catch{}
  return null
}
export default function Discovery() {
  const { project, notify } = useStudio()
  const [saved]=useState(savedDraft)
  const [posts, setPosts] = useState<Post[]>([]),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [kind, setKind] = useState(""),
    [mine, setMine] = useState(false),
    [next, setNext] = useState("")
  const [form, setForm] = useState<typeof empty>(saved?.form || empty),
    [composer, setComposer] = useState(false),
    [editing, setEditing] = useState<Post | null>(saved?.editing || null),
    [confirmed, setConfirmed] = useState(false),
    [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [focused, setFocused] = useState<Post | null>(null)
  const submission = useRef(saved?.submission || crypto.randomUUID()),
    generation = useRef(0),
    composerHeading = useRef<HTMLHeadingElement>(null)
  const identity = currentWorkspaceIdentity()
  useEffect(()=>{
    try{if(form.title || form.body)sessionStorage.setItem(draftKey(),JSON.stringify({form,editing,submission:submission.current}));else sessionStorage.removeItem(draftKey())}catch{}
  },[form,editing])
  const load = async (more = false) => {
    const ticket = ++generation.current
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams({
        q: search,
        kind,
        mine: String(mine),
        before: more ? next : "",
      })
      const data = await api<{ posts: Post[]; next: string }>(
        "/api/ui/discovery?" + params,
      )
      if (ticket !== generation.current) return
      setPosts((old) =>
        more
          ? [
              ...old,
              ...data.posts.filter(
                (post) => !old.some((item) => item.id === post.id),
              ),
            ]
          : data.posts,
      )
      setNext(data.next)
    } catch (e) {
      if (ticket === generation.current) setError(errorText(e))
    } finally {
      if (ticket === generation.current) setLoading(false)
    }
  }
  useEffect(() => {
    void load()
    return () => {
      generation.current++
    }
  }, [search, kind, mine, identity])
  useEffect(() => {
    const id = new URLSearchParams(location.hash.split("?")[1] || "").get(
      "post",
    )
    if (!id) return
    let active = true
    void api<Post>("/api/ui/discovery/" + encodeURIComponent(id))
      .then((value) => {
        if (active) setFocused(value)
      })
      .catch((e) => {
        if (active) setError(errorText(e))
      })
    return () => {
      active = false
    }
  }, [identity])
  useEffect(() => {
    if (composer) composerHeading.current?.focus()
  }, [composer])
  const reset = () => {
    setForm(empty)
    setEditing(null)
    setConfirmed(false)
    setPreview(false)
    submission.current = crypto.randomUUID()
  }
  const publish = async () => {
    setBusy(true)
    setError("")
    try {
      const body = {
        ...form,
        tags: form.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        confirm_public: confirmed,
        submission_id: submission.current,
        revision: editing?.revision,
        published: true,
      }
      const value = await api<Post>(
        "/api/ui/discovery" + (editing ? "/" + editing.id : ""),
        body,
        editing ? "PATCH" : "POST",
      )
      setPosts((old) => [value, ...old.filter((post) => post.id !== value.id)])
      setComposer(false)
      reset()
      setFocused(value)
      notify("Your post is shared with other members.")
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const withdraw = async (post: Post) => {
    setBusy(true)
    setError("")
    try {
      const value = await api<Post>(
        "/api/ui/discovery/" + post.id,
        { ...post, published: false },
        "PATCH",
      )
      setPosts((old) =>
        mine
          ? old.map((item) => (item.id === post.id ? value : item))
          : old.filter((item) => item.id !== post.id),
      )
      if (focused?.id === post.id) setFocused(null)
      notify("Post withdrawn. Your private project is unchanged.")
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const report = async (post: Post, reason: string) => {
    setBusy(true)
    setError("")
    try {
      await api("/api/ui/discovery/" + post.id + "/report", { reason })
      setPosts((old) => old.filter((item) => item.id !== post.id))
      if (focused?.id === post.id) setFocused(null)
      notify("Report saved. This post is hidden from your feed.")
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const edit = (post: Post) => {
    setForm({
      kind: post.kind,
      title: post.title,
      body: post.body,
      tags: post.tags.join(", "),
    })
    setEditing(post)
    setConfirmed(false)
    setPreview(false)
    setComposer(true)
  }
  const card = (post: Post) => (
    <article className="panel discovery-post" key={post.id}>
      <div className="post-meta">
        <span>{post.kind}</span>
        <span>{post.author_name}</span>
        <time dateTime={post.created_at}>{fmtDate(post.created_at)}</time>
        {!post.published && <b>Withdrawn</b>}
      </div>
      <h2>{post.title}</h2>
      <p className="post-body">{focused?.id===post.id || post.body.length<=650?post.body:post.body.slice(0,650)+'…'}</p>
      {post.body.length>650 && focused?.id!==post.id && <button className="text-action" onClick={()=>setFocused(post)}>Read post</button>}
      <div className="post-tags">
        {post.tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      <div className="comment-actions">
        <button
          disabled={busy}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                location.origin +
                  location.pathname +
                  "#/discovery?post=" +
                  post.id,
              )
              notify("Post link copied. Sign-in is needed to read it.")
            } catch {
              notify("Could not copy. Open the post and copy its address.")
            }
          }}
        >
          Copy link
        </button>
        {post.mine && (
          <>
            <button disabled={busy} onClick={() => edit(post)}>
              Edit post
            </button>
            {post.published && (
              <button disabled={busy} onClick={() => void withdraw(post)}>
                Withdraw
              </button>
            )}
          </>
        )}
      </div>
      {!post.mine && (
        <details>
          <summary>Report and hide</summary>
          <p className="hint">
            Your report is saved and the post is hidden from your feed.
          </p>
          <form onSubmit={event=>{event.preventDefault();const reason=new FormData(event.currentTarget).get('reason');if(typeof reason==='string')void report(post,reason)}}><label className="field">
            Reason
            <select
              defaultValue=""
              disabled={busy}
              name="reason" required
            >
              <option value="" disabled>
                Choose a reason
              </option>
              {["Spam", "Harassment", "Rights concern", "Other"].map(
                (reason) => (
                  <option key={reason}>{reason}</option>
                ),
              )}
            </select>
          </label><button disabled={busy} type="submit">Report and hide post</button></form>
        </details>
      )}
    </article>
  )
  return (
    <div className="page discovery-page">
      <PageTitle
        eyebrow="COMMUNITY"
        title="Discovery"
        text="Share a project, story or character with other members. Your private workspace stays separate."
      >
        <button
          className="primary"
          disabled={busy}
          onClick={() => setComposer(!composer)}
        >
          {composer ? "Close draft" : form.title || form.body ? "Continue post" : "Share a post"}
        </button>
        <HelpTip label="Who can read Discovery posts?">
          Posts are visible to signed-in members. Publish only material you have
          the right to share. Team membership does not automatically publish a
          project.
        </HelpTip>
      </PageTitle>
      {error && (
        <p role="alert" className="live-status error">
          {error}
          <button onClick={() => void load()}>Retry loading</button>
        </p>
      )}
      {composer && (
        <section className="panel discovery-composer" aria-label="Post draft">
          <h2 ref={composerHeading} tabIndex={-1}>
            {editing ? "Edit your post" : "What would you like to share?"}
          </h2>
          <div className="form-grid">
            <label className="field">
              Post type
              <select
                value={form.kind}
                onChange={(e) => {
                  setForm({ ...form, kind: e.target.value })
                  setPreview(false)
                }}
              >
                {["project", "story", "character"].map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Title
              <input
                maxLength={150}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
          </div>
          {project.id && (
            <details>
              <summary>Start from your project</summary>
              <p>
                Only the text you put in this post is shared. Review it before
                publishing.
              </p>
              <button
                onClick={() =>
                  setForm({
                    ...form,
                    title: project.title,
                    body: project.brief.premise,
                  })
                }
              >
                Use project summary
              </button>
              {form.kind === "character" &&
                project.brief.characters.map((character) => (
                  <button
                    key={character.id}
                    onClick={() =>
                      setForm({
                        ...form,
                        title: character.name,
                        body: [
                          character.goal && "Goal: " + character.goal,
                          character.voice && "Voice: " + character.voice,
                          character.arc.change &&
                            "Character arc: " + character.arc.change,
                        ]
                          .filter(Boolean)
                          .join("\n"),
                      })
                    }
                  >
                    {character.name || "Unnamed character"}
                  </button>
                ))}
            </details>
          )}
          <label className="field">
            Your post
            <textarea
              rows={8}
              maxLength={12000}
              value={form.body}
              onChange={(e) => {
                setForm({ ...form, body: e.target.value })
                setPreview(false)
              }}
              placeholder="Introduce your project, share an excerpt, or describe a character."
            />
          </label>
          <label className="field">
            Tags · optional
            <input
              value={form.tags}
              maxLength={154}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="Up to five tags, separated by commas"
            />
          </label>
          <button className="secondary" onClick={() => setPreview(!preview)}>
            {preview ? "Hide preview" : "Preview post"}
          </button>
          {preview && (
            <article className="post-preview">
              <h3>{form.title || "Your title"}</h3>
              <p className="post-body">{form.body || "Your post text"}</p>
            </article>
          )}
          <label className="toggle">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I want to share this text with other members and have the right to
            publish it.
          </label>
          <button
            className="primary"
            disabled={
              busy ||
              !confirmed ||
              !form.title.trim() ||
              form.body.trim().length < 10
            }
            onClick={() => void publish()}
          >
            {busy
              ? "Publishing…"
              : editing
                ? "Publish changes"
                : "Publish post"}
          </button>
        </section>
      )}
      {focused && (
        <section aria-label="Linked post">
          <button
            className="text-action"
            onClick={() => {
              setFocused(null)
              history.replaceState(null, "", location.pathname + "#/discovery")
            }}
          >
            Back to all posts
          </button>
          {card(focused)}
        </section>
      )}
      {!focused && (
        <>
          <form
            className="discovery-filters"
            onSubmit={(event) => {
              event.preventDefault()
              setSearch(query)
            }}
          >
            <label className="field">
              Search posts
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                maxLength={120}
              />
            </label>
            <button type="submit">Search</button>
            <label className="field">
              Type
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">All posts</option>
                {["project", "story", "character"].map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={mine}
                onChange={(e) => setMine(e.target.checked)}
              />
              My posts
            </label>
          </form>
          <div className="discovery-feed" aria-busy={loading}>
            {posts.map(card)}
          </div>
          {loading && <p role="status">Loading posts…</p>}
          {!loading && !posts.length && !error && (
            <div className="panel empty">
              <h2>
                {search || kind
                  ? "No matching posts"
                  : "A place for work in progress"}
              </h2>
              <p>
                {search || kind
                  ? "Try a different search or post type."
                  : "Share your first project, excerpt or character when you are ready."}
              </p>
            </div>
          )}
          {next && (
            <button disabled={loading} onClick={() => void load(true)}>
              Load more posts
            </button>
          )}
        </>
      )}
    </div>
  )
}
