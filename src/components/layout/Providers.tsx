'use client'

import { SessionProvider } from 'next-auth/react'
import { useEffect }       from 'react'
import { ThemeProvider }   from '@/components/theme/ThemeProvider'
import SheetStackProvider  from '@/components/sheets/SheetStackProvider'

export default function Providers({ children }: { children: React.ReactNode }) {

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    // Enregistrer notre SW custom minimaliste (push) en plus du SW next-pwa
    navigator.serviceWorker
      .register('/sw-custom.js', { scope: '/' })
      .then(reg => {
        console.log('[SW Custom] Enregistré — state:',
          reg.active?.state ?? reg.installing?.state ?? 'waiting')
      })
      .catch(err => console.error('[SW Custom] Erreur:', err))
  }, [])

  return (
    <ThemeProvider>
      <SessionProvider>
        <SheetStackProvider>{children}</SheetStackProvider>
      </SessionProvider>
    </ThemeProvider>
  )
}
