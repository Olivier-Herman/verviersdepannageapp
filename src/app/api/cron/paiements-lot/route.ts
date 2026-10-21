// src/app/api/cron/paiements-lot/route.ts — lot de paiement du jour (Olivier 16/10/2026).
// 13 h 30 : Olivier est prévenu des factures à trier. Lundi → vendredi, jamais un jour férié.
// 14 h 30 : Momo est prévenu UNE fois de la liste d'attente (lib/paiements/rappel-lot.ts) — Olivier 21/10/2026 :
// « remettre la notif à Momo uniquement à 14 h 30, une fois par jour du lundi au vendredi, comme ça je peux alimenter
// plusieurs fois s'il faut sans que chaque fois il reçoive une notif ». Rien n'est envoyé si la liste est vide.
// C'est Olivier qui trie (lui seul ajoute à la liste d'attente) ; Momo choisit dans la liste ce qui part.
// Trois déclenchements (11 h 30, 12 h 30, 13 h 30 UTC) couvrent l'heure d'été et d'hiver : l'étape dépend de l'heure
// à Bruxelles (13 h = tri, 14 h = lot), le troisième passage ne fait rien. Un échec doit se voir.

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

import { NextResponse } from 'next/server'
import { RAPPEL_PAIEMENTS } from '@/lib/paiements/rappel-lot'

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const heure = Number(new Date().toLocaleString('en-US', { timeZone: 'Europe/Brussels', hour: '2-digit', hour12: false }))
    const force = new URL(req.url).searchParams.get('force') === '1'
    const { SOCIETES, aTrier, jourOuvrable } = await import('@/lib/paiements/fournisseurs')
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
      const r = await sendNotificationToMany(ids, 'paiements_a_trier', { title: 'Paiements fournisseurs à trier', body: `${parts.join(' · ')}. Ce que tu ajoutes à la liste d'attente sera présenté à Momo à 14 h 30.`, action_url: '/paiements', data: RAPPEL_PAIEMENTS })
      return NextResponse.json({ ok: true, etape, parts, ...r })
    }

    if (etape !== 'lot') return NextResponse.json({ ok: true, skipped: `étape inconnue ${etape}` })
    const { prevenirLotDuJour } = await import('@/lib/paiements/rappel-lot')
    return NextResponse.json({ ok: true, etape, ...(await prevenirLotDuJour()) })
  } catch (e: any) {
    console.error('[cron paiements-lot]', e?.message || e)
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
