/** Public frontend configuration contains an API address, never provider keys. */
const configured = (import.meta.env.VITE_API_BASE || '').trim().replace(/\/$/, '')
function validBase(value: string) {
  if (!value) return ''
  const url = new URL(value)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw Error('Configure one HTTPS backend origin.')
  return url.origin
}
export const API_BASE = validBase(configured)
let studioIdentity = ''
export const currentStudioIdentity = () => studioIdentity
export const setStudioIdentity = (id: string) => { studioIdentity = id }
export const studioHost = () => !!API_BASE || ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname) || document.querySelector('meta[name="paramyth-studio"]')?.getAttribute('content') === 'live'
export function backendUrl(path: string) {
  const absolute = /^https?:\/\//.test(path)
  if (!absolute && (!path.startsWith('/') || path.startsWith('//'))) throw Error('Expected a backend path.')
  const url = new URL(path, API_BASE || location.origin)
  if (url.origin !== (API_BASE || location.origin)) throw Error('Unexpected backend address.')
  const accountRoute = /^\/api\/v1\/(accounts|studios|invitations)(\/|$)/.test(url.pathname)
  if (/^\/(api|media|export|google)\//.test(url.pathname) && !accountRoute) {
    const selected = url.searchParams.get('studio_id')
    if (selected && selected !== studioIdentity) throw Error('Your team workspace changed. Reopen this project.')
    if (studioIdentity) url.searchParams.set('studio_id', studioIdentity)
  }
  const guestMode = !!API_BASE || document.querySelector('meta[name="paramyth-studio"]')?.getAttribute('content') === 'live'
  if (guestMode && (/^\/media\//.test(url.pathname) || /^\/export\//.test(url.pathname) || (/^\/api\/ui\/creative\/jobs\//.test(url.pathname) && url.pathname.endsWith('/events'))))
    url.searchParams.set('guest_id', guestId())
  return API_BASE || absolute ? url.href : url.pathname + url.search + url.hash
}
const guestKey = 'paramyth-guest:' + (API_BASE || location.origin)
function guestId() {
  let id = localStorage.getItem(guestKey) || ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    id = crypto.randomUUID()
    localStorage.setItem(guestKey, id)
  }
  return id
}
export const backendFetch = (path: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers)
  if (API_BASE || document.querySelector('meta[name="paramyth-studio"]')?.getAttribute('content') === 'live')
    headers.set('X-ParaMyth-Guest', guestId())
  return fetch(backendUrl(path), { ...options, headers, credentials: 'omit' })
}
