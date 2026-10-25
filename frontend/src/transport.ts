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
export const studioHost = () => !!API_BASE || ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname) || document.querySelector('meta[name="paramyth-studio"]')?.getAttribute('content') === 'live'
export function backendUrl(path: string) {
  if (/^https?:\/\//.test(path)) {
    const url = new URL(path)
    if (url.origin !== (API_BASE || location.origin)) throw Error('Unexpected backend address.')
    return url.href
  }
  if (!path.startsWith('/') || path.startsWith('//')) throw Error('Expected a backend path.')
  return API_BASE + path
}
export const backendFetch = (path: string, options: RequestInit = {}) => fetch(backendUrl(path), { ...options, credentials: 'include' })
