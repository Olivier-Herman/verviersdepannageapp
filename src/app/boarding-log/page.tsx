// src/app/boarding-log/page.tsx
//
// JOURNAL DE BORD — page PUBLIQUE protégée par PIN (hors matcher middleware),
// comme /tableau-bord et /boarding. Faite pour rester allumée en permanence :
// chiffres du jour, missions en cours, anomalies et journal en direct.
// Olivier 2026-08-14.

import BoardingLogClient from './BoardingLogClient'

export const dynamic  = 'force-dynamic'
// Son propre manifeste (Olivier 08/10/2026) : installée sur l'écran d'accueil, l'app s'ouvre sur le
// journal de bord et non sur /dashboard, qui demande la connexion.
export const metadata = { title: 'Journal de bord — VD Soft', manifest: '/journal.webmanifest', appleWebApp: { capable: true, title: 'Journal de bord', statusBarStyle: 'default' as const } }

export default function BoardingLogPage() {
  return <BoardingLogClient />
}
