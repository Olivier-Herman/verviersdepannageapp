// src/app/tableau-bord/page.tsx
//
// Mur d'écran ops — PAGE PUBLIQUE (hors matcher middleware), protégée par un PIN
// à 6 chiffres. Plein écran, temps réel, slides auto-rotatives. Olivier 2026-07-30.

import TableauBordClient from './TableauBordClient'

export const dynamic  = 'force-dynamic'
export const metadata = { title: 'Tableau de bord — VD Soft' }

export default function TableauBordPage() {
  return <TableauBordClient />
}
