'use client'

import { SessionProvider, useSession } from 'next-auth/react'
import { useEffect }                   from 'react'
import { ThemeProvider }               from '@/components/theme/ThemeProvider'
import SheetStackProvider              from '@/components/sheets/SheetStackProvider'
import { AudioModeProvider }           from '@/components/audio/AudioModeProvider'
import { TruckConfirmModal }           from '@/components/trucks/TruckConfirmModal'
import { I18nProvider }                from '@/lib/i18n/I18nProvider'
import type { Lang }                   from '@/lib/i18n/types'
import { PwaNativeGuard }              from '@/components/PwaNativeGuard'

function AudioModeMount() {
  const { data: session } = useSession()
  const enabled = !!(session?.user as any)?.audioMode
  return <AudioModeProvider enabled={enabled} />
}

// Olivier 2026-06-22 : certains utilisateurs (chauffeur sur tablette Samsung,
// admins) peuvent utiliser l'app en mode PORTRAIT. On pose la classe
// .portrait-ok sur <body> qui désactive l'overlay "Tourne en paysage"
// (cf. globals.css) sur tablette.
function PortraitModeMount() {
  const { data: session } = useSession()
  const role  = (session?.user as any)?.role || ''
  const roles = (session?.user as any)?.roles || [role]
  const ALLOW_PORTRAIT = ['admin', 'superadmin', 'driver', 'chauffeur']
  const allow = ALLOW_PORTRAIT.some(r => role === r || (Array.isArray(roles) && roles.includes(r)))
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.body.classList.toggle('portrait-ok', allow)
  }, [allow])
  return null
}

function I18nMount({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()
  const lang = ((session?.user as any)?.language || 'fr') as Lang
  return <I18nProvider initialLang={lang}>{children}</I18nProvider>
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
        <PortraitModeMount />
        <TruckConfirmModal />
        <I18nMount>
          <PwaNativeGuard>
            <SheetStackProvider>{children}</SheetStackProvider>
          </PwaNativeGuard>
        </I18nMount>
      </SessionProvider>
    </ThemeProvider>
  )
}
