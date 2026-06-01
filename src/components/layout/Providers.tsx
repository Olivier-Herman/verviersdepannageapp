'use client'

import { SessionProvider, useSession } from 'next-auth/react'
import { useEffect }                   from 'react'
import { ThemeProvider }               from '@/components/theme/ThemeProvider'
import SheetStackProvider              from '@/components/sheets/SheetStackProvider'
import { AudioModeProvider }           from '@/components/audio/AudioModeProvider'
import { TruckConfirmModal }           from '@/components/trucks/TruckConfirmModal'

function AudioModeMount() {
  const { data: session } = useSession()
  const enabled = !!(session?.user as any)?.audioMode
  return <AudioModeProvider enabled={enabled} />
}

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
        <AudioModeMount />
        <TruckConfirmModal />
        <SheetStackProvider>{children}</SheetStackProvider>
      </SessionProvider>
    </ThemeProvider>
  )
}
