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
  return API_BASE || absolute ? url.href : url.pathname + url.search + url.hash
}
export const backendFetch = (path: string, options: RequestInit = {}) => fetch(backendUrl(path), { ...options, credentials: 'include' })
