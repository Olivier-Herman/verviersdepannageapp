// src/app/boarding-log/page.tsx
//
// JOURNAL DE BORD — page PUBLIQUE protégée par PIN (hors matcher middleware),
// comme /tableau-bord et /boarding. Faite pour rester allumée en permanence :
// chiffres du jour, missions en cours, anomalies et journal en direct.
// Olivier 2026-08-14.

import BoardingLogClient from './BoardingLogClient'

export const dynamic  = 'force-dynamic'
export const metadata = { title: 'Journal de bord — VD Soft' }

export default function BoardingLogPage() {
  return <BoardingLogClient />
}
