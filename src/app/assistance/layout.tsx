import type { Metadata, Viewport } from 'next'
import '../espace/espace.css'
import './assistance.css'

export const metadata: Metadata = {
  title: 'VD Assistance — Verviers Dépannage',
  description: 'Commandez votre dépannage Verviers Dépannage, partenaire de votre garage.',
  manifest: '/vd-assistance.webmanifest',
  appleWebApp: { capable: true, title: 'VD Assistance', statusBarStyle: 'default' },
  icons: { icon: '/noprecache/assistance/icon-192.png', apple: '/noprecache/assistance/icon-180.png' },
}
export const viewport: Viewport = { themeColor: '#151a2d', viewportFit: 'cover' }

export default function AssistanceLayout({ children }: { children: React.ReactNode }) {
  return <div className="esp dcl">{children}</div>
}
