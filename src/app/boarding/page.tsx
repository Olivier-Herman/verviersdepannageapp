// src/app/boarding/page.tsx
//
// Tableau de bord DISPATCH (Momo) — PAGE PUBLIQUE (hors matcher middleware),
// protégée par PIN. Sous-ensemble d'écrans du mur ops : en commande / en attente /
// en cours / à relivrer, stats chauffeur (jour/7j/30j) et missions en cours &
// assignées. Olivier 2026-07-30.

import TableauBordClient from '../tableau-bord/TableauBordClient'

export const dynamic  = 'force-dynamic'
export const metadata = { title: 'Dispatch — VD Soft' }

export default function BoardingPage() {
  return <TableauBordClient variant="dispatch" />
}
