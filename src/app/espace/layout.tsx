import type { Metadata } from 'next'
import './espace.css'

export const metadata: Metadata = {
  title: 'Espace client — Verviers Dépannage',
  description: 'Commandez une intervention et suivez vos dépannages en direct.',
  manifest: undefined,
}

export default function EspaceLayout({ children }: { children: React.ReactNode }) {
  return <div className="esp">{children}</div>
}
