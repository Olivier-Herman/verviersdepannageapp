// src/app/api/cron/paiements-lot/route.ts — lot de paiement du jour (Olivier 16/10/2026).
// 13 h 30 : Olivier est prévenu des factures à trier ; 14 h 30 : Momo reçoit la liste d'attente. Lundi → vendredi, jamais un jour férié.
// C'est Olivier qui trie (lui seul ajoute à la liste d'attente) ; Momo choisit dans la liste ce qui part.
// Trois déclenchements (11 h 30, 12 h 30, 13 h 30 UTC) couvrent l'heure d'été et d'hiver : l'étape dépend de l'heure
// à Bruxelles (13 h = tri, 14 h = lot), les autres passages ne font rien. Un échec doit se voir.
// Encadré qui reste en bas d'écran jusqu'au clic (un bandeau de 8 s passait inaperçu, Olivier 19/10/2026).
const RAPPEL = { modal: true, non_blocking: true, kind: 'rappel_paiements' }

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

import { NextResponse } from 'next/server'

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const heure = Number(new Date().toLocaleString('en-US', { timeZone: 'Europe/Brussels', hour: '2-digit', hour12: false }))
    const force = new URL(req.url).searchParams.get('force') === '1'
    const { SOCIETES, listeAttente, aTrier, jourOuvrable } = await import('@/lib/paiements/fournisseurs')
    const etape = new URL(req.url).searchParams.get('etape') || (heure === 13 ? 'tri' : heure === 14 ? 'lot' : '')
    if (!force && !etape) return NextResponse.json({ ok: true, skipped: `heure locale ${heure}` })
    if (!force && !jourOuvrable()) return NextResponse.json({ ok: true, skipped: 'week-end ou jour férié' })

    // 13 h 30 : Olivier seul est prévenu qu'il y a des factures à trier (Momo ne reçoit pas cette notification).
    if (etape === 'tri') {
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
      const parts: string[] = []
      for (const s of SOCIETES) {
        const t = await aTrier(s.id)
        const retard = t.filter(f => f.due_date && f.due_date < today).length
        if (t.length) parts.push(`${s.label} : ${t.length} à trier${retard ? ` dont ${retard} en retard` : ''}`)
      }
      if (!parts.length) return NextResponse.json({ ok: true, skipped: 'rien à trier' })
      const { getBusinessList } = await import('@/lib/settings/business')
      const { sendNotificationToMany } = await import('@/lib/notifications/send')
      const ids = await getBusinessList('paiements_tri_user_ids')
      const r = await sendNotificationToMany(ids, 'paiements_a_trier', { title: 'Paiements fournisseurs à trier', body: `${parts.join(' · ')}. Ce que tu ajoutes à la liste d'attente part chez Momo à 14 h 30.`, action_url: '/paiements', data: RAPPEL })
      return NextResponse.json({ ok: true, etape, parts, ...r })
    }

    const parts: string[] = []
    for (const s of SOCIETES) {
      const q = await listeAttente(s.id)
      if (q.length) parts.push(`${s.label} : ${q.length} facture(s), ${eur(q.reduce((t, f) => t + f.amount, 0))}`)
    }
    if (!parts.length) return NextResponse.json({ ok: true, skipped: 'liste d’attente vide' })

    const { getBusinessList } = await import('@/lib/settings/business')
    const { sendNotificationToMany } = await import('@/lib/notifications/send')
    const ids = await getBusinessList('paiements_lot_user_ids')
    const r = await sendNotificationToMany(ids, 'paiements_lot_du_jour', { title: 'Lot de paiement du jour', body: `${parts.join(' · ')}. Choisis ce qui part aujourd'hui.`, action_url: '/paiements', data: RAPPEL })
    return NextResponse.json({ ok: true, parts, ...r })
  } catch (e: any) {
    console.error('[cron paiements-lot]', e?.message || e)
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
