// src/app/api/cron/paiements-lot/route.ts — lot de paiement du jour (Olivier 16/10/2026).
// 14 h 30 heure belge, du lundi au vendredi, jamais un jour férié : Momo reçoit la liste d'attente
// (VD et Riga) pour choisir ce qui part dans le lot. Deux déclenchements (12 h 30 et 13 h 30 UTC)
// couvrent l'heure d'été et d'hiver ; seul celui qui tombe à 14 h à Bruxelles envoie. Un échec doit se voir.
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
    const { SOCIETES, listeAttente, jourOuvrable } = await import('@/lib/paiements/fournisseurs')
    if (!force && heure !== 14) return NextResponse.json({ ok: true, skipped: `heure locale ${heure}` })
    if (!force && !jourOuvrable()) return NextResponse.json({ ok: true, skipped: 'week-end ou jour férié' })

    const parts: string[] = []
    for (const s of SOCIETES) {
      const q = await listeAttente(s.id)
      if (q.length) parts.push(`${s.label} : ${q.length} facture(s), ${eur(q.reduce((t, f) => t + f.amount, 0))}`)
    }
    if (!parts.length) return NextResponse.json({ ok: true, skipped: 'liste d’attente vide' })

    const { getBusinessList } = await import('@/lib/settings/business')
    const { sendNotificationToMany } = await import('@/lib/notifications/send')
    const ids = await getBusinessList('paiements_lot_user_ids')
    const r = await sendNotificationToMany(ids, 'paiements_lot_du_jour', { title: 'Lot de paiement du jour', body: `${parts.join(' · ')}. Choisis ce qui part aujourd'hui.`, action_url: '/paiements' })
    return NextResponse.json({ ok: true, parts, ...r })
  } catch (e: any) {
    console.error('[cron paiements-lot]', e?.message || e)
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
