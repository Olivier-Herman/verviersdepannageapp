// src/app/api/paiements/route.ts — module Paiements fournisseurs (Olivier 16/10/2026).
// GET ?societe=<id>           → factures à trier (tri), liste d'attente, droits
// POST {societe, action, ids} → ajouter | retirer | confirmer_compte (tri, superadmin) | lot (Momo ou superadmin)
export const dynamic     = 'force-dynamic'
export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { accesPaiements }            from '@/lib/paiements/acces'
import { SOCIETES, societe, aTrier, listeAttente, ajouter, retirer, creerLot, confirmerCompte } from '@/lib/paiements/fournisseurs'

export async function GET(req: NextRequest) {
  const acc = await accesPaiements(await getServerSession(authOptions))
  if (!acc.lot) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const C = Number(req.nextUrl.searchParams.get('societe') || SOCIETES[0].id)
  try {
    societe(C)
    const [attente, trier] = await Promise.all([listeAttente(C), acc.tri ? aTrier(C) : Promise.resolve(null)])
    return NextResponse.json({ attente, aTrier: trier, droits: { tri: acc.tri, lot: acc.lot } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const acc = await accesPaiements(session)
  const { societe: C, action, ids } = await req.json().catch(() => ({} as any))
  if (!Array.isArray(ids) || !ids.length) return NextResponse.json({ error: 'Rien de coché' }, { status: 400 })
  try {
    const s = societe(Number(C))
    if (action === 'confirmer_compte') {
      if (!acc.tri) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
      await confirmerCompte(s.id, Number(ids[0]))
      return NextResponse.json({ ok: true })
    }
    if (action === 'ajouter' || action === 'retirer') {
      if (!acc.tri) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
      if (action === 'ajouter') {
        const ajoutees = await ajouter(s.id, ids.map(Number), acc.id)
        // Momo n'est plus prévenu à chaque ajout : un seul rappel à 14 h 30, lundi → vendredi (Olivier 21/10/2026 :
        // « je peux alimenter plusieurs fois s'il faut sans que chaque fois il reçoive une notif »).
        return NextResponse.json({ ok: true, ajoutees })
      }
      await retirer(s.id, ids.map(String), acc.id)
      return NextResponse.json({ ok: true })
    }
    if (action === 'lot') {
      if (!acc.lot) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
      const r = await creerLot(s.id, ids.map(String), acc.id)
      await prevenirLotCree(s.label, r, session?.user?.name || 'Quelqu’un').catch(e => console.error('[paiements] prévenir', e?.message || e))
      return NextResponse.json({ ok: true, ...r })
    }
    return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`

/** Lot créé → Olivier prévenu (notification + Telegram privé) : il génère le XML et l'encode à la banque. */
async function prevenirLotCree(label: string, r: { lot: string; factures: number; total: number; lotTotal: number; ajoute: boolean }, qui: string) {
  const { getBusinessList, getBusinessNumber } = await import('@/lib/settings/business')
  const { sendNotificationToMany } = await import('@/lib/notifications/send')
  const title = `Lot ${r.lot} prêt · ${label}`
  const body = `${qui} a choisi ${r.factures} facture(s), ${eur(r.total)}${r.ajoute ? ` (ajoutées au lot, total ${eur(r.lotTotal)})` : ''}. Il reste à générer le fichier et à l'encoder à la banque.`
  const ids = await getBusinessList('paiements_xml_user_ids')
  if (ids.length) await sendNotificationToMany(ids, 'paiements_lot_cree', { title, body, action_url: '/paiements' })
  const { tgSend } = await import('@/lib/sam/telegram')
  await tgSend(await getBusinessNumber('telegram_chat_mobi'), `${title}\n${body}`).catch(() => {})
}
