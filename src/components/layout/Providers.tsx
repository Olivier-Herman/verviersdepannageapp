'use client'

import { SessionProvider } from 'next-auth/react'
import { useEffect }       from 'react'

export default function Providers({ children }: { children: React.ReactNode }) {

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then(reg => {
          console.log('[SW] Enregistré — scope:', reg.scope, '— state:', reg.active?.state ?? reg.installing?.state ?? 'unknown')
        })
        .catch(err => {
          console.error('[SW] Erreur enregistrement:', err)
        })
    }
  }, [])

  return <SessionProvider>{children}</SessionProvider>
}
