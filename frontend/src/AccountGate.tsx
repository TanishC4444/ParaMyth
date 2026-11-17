import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { backendFetch, studioHost } from './api'
import { PageLoading, RecoveryPage } from './system-pages'

export type Team = { id: string; name: string; role: 'owner'|'admin'|'editor'|'viewer' }
type Access = { account?: { id: string; email: string; display_name: string }; accounts_required: boolean; shared_keys: boolean; github_admin: boolean; authenticated?: boolean; teams?: Team[]; studio?: Team; openStudio?:(id:string)=>Promise<void> }
const localAccess: Access = { accounts_required: false, shared_keys: false, github_admin: true }
const AccessContext = createContext<Access>(localAccess)
export const useAccess = () => useContext(AccessContext)

export default function AccountGate({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<Access>(localAccess)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!studioHost()) {
      setReady(true)
      return
    }
    let stopped = false
    void backendFetch('/api/ui/public-config', { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw Error('Could not connect to the public studio.')
        const config = await response.json()
        if (config.accounts_required) throw Error('This server still requires accounts. Deploy the account-free main configuration.')
        if (!stopped) setAccess({
          accounts_required: false,
          shared_keys: config.shared_keys !== false,
          github_admin: false,
        })
      })
      .catch(reason => { if (!stopped) setError(reason instanceof Error ? reason.message : 'Could not connect to the public studio.') })
      .finally(() => { if (!stopped) setReady(true) })
    return () => { stopped = true }
  }, [])

  if (!ready) return <div className="night-page"><PageLoading label="Opening the public studio…" /></div>
  if (error) return <RecoveryPage message={error} />
  return <AccessContext.Provider value={access}>{children}</AccessContext.Provider>
}
