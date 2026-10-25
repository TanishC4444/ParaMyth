import { useEffect, useState, type FormEvent } from 'react'
import './account.css'
import { backendFetch } from './transport'

export default function AccountPage({ signup, available, onSignedIn, invitation='' }: { signup: boolean; available: boolean; onSignedIn: () => Promise<void>; invitation?:string }) {
  useEffect(() => { document.title = signup ? "Create an account · ParaMyth" : "Sign in · ParaMyth" }, [signup])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!available || busy) return
    setBusy(true); setError('')
    try {
      const response = await backendFetch(`/api/v1/accounts/${signup ? 'signup' : 'login'}`, {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, ...(signup ? { display_name: name } : {}) }),
      })
      if(!(response.headers.get('content-type') || '').includes('json'))throw Error("We couldn't reach your studio. Try again in a moment.")
      const value = await response.json().catch(()=>null)
      if(!value)throw Error("We couldn't reach your studio. Try again in a moment.")
      if (!response.ok) {
        const detail = value?.detail
        throw Error(response.status===503?"Accounts aren't available in this studio yet.":typeof detail === 'string' ? detail : 'We couldn’t sign you in. Check your details and try again.')
      }
      setPassword('')
      try { localStorage.setItem('paramyth-account-change', String(Date.now())) } catch {}
      await onSignedIn()
      location.hash = invitation ? '#/join?invite='+encodeURIComponent(invitation) : '#/workflow'
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'We couldn’t reach the studio. Try again.')
    } finally { setBusy(false) }
  }
  return <main className="account-entry">
    <a className="account-home" href="#/" aria-label="ParaMyth home"><img src="/brand/studio-symbol.png" width="1280" height="720" alt="ParaMyth" /><span>Back to the story atlas</span></a>
    <section className="account-picture" aria-label="A world of stories">
      <div><p className="eyebrow">YOUR NEXT CHAPTER</p><h1>A world of stories.<br />A space for yours.</h1><p>Bring your ideas, writing, images and sound together. Your work will be here when you return.</p></div>
    </section>
    <section className="account-form-panel" aria-labelledby="account-title">
      <div className="account-tabs" aria-label="Account options"><a aria-current={!signup ? 'page' : undefined} href={'#/signin'+(invitation?'?invite='+encodeURIComponent(invitation):'')}>Sign in</a><a aria-current={signup ? 'page' : undefined} href={'#/signup'+(invitation?'?invite='+encodeURIComponent(invitation):'')}>Create account</a></div>
      <p className="eyebrow">YOUR CREATIVE WORKSPACE</p>
      <h2 id="account-title">{signup ? 'Start your story.' : 'Welcome back.'}</h2>
      <p>{signup ? 'Create an account to save everything you make.' : 'Sign in to pick up where you left off.'}</p>
      {invitation && <p className="account-notice">Sign in with your invited email address. You’ll join the team and go straight to its projects.</p>}
      {!available && <p className="account-notice" role="status">The online studio isn’t connected yet. You can explore the story atlas while we finish setting it up.</p>}
      <form onSubmit={submit}>
        {signup && <label className="field">Your name<input disabled={!available||busy} autoComplete="name" value={name} onChange={event => setName(event.target.value)} maxLength={100} required /></label>}
        <label className="field">Email address<input disabled={!available||busy} type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} required /></label>
        <label className="field">Password<input disabled={!available||busy} type="password" autoComplete={signup ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} minLength={1} maxLength={128} required /></label>
        {error && <p className="account-error" role="alert">{error}</p>}
        <button className="primary" disabled={busy || !available}>{busy ? 'Opening your studio…' : signup ? 'Create account' : 'Sign in'}</button>
      </form>
      <p className="account-service-note">Writing, images and music use the studio’s connected services. You don’t need your own API keys.</p>
      <a href="#/atlas">Explore the story atlas</a>
    </section>
  </main>
}
