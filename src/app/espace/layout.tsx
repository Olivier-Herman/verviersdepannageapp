import type { Metadata, Viewport } from 'next'
import './espace.css'

export const metadata: Metadata = {
  title: 'Espace client — Verviers Dépannage',
  description: 'Commandez une intervention et suivez vos dépannages en direct.',
  // Installable sur l'écran d'accueil (« VD Espace pro », Olivier 20/10/2026) : manifeste propre à /espace,
  // distinct de VD Soft et de VD Assistance.
  manifest: '/vd-espace.webmanifest',
  appleWebApp: { capable: true, title: 'VD Espace pro', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192x192.png', apple: '/icons/apple-touch-icon.png' },
}
export const viewport: Viewport = { themeColor: '#151a2d', viewportFit: 'cover' }

export default function EspaceLayout({ children }: { children: React.ReactNode }) {
  return <div className="esp">{children}</div>
}
