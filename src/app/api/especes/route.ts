// src/app/api/especes/route.ts — remise des espèces à Momo (Olivier 06/10/2026).
//   GET  → { role, items } : vue d'Olivier (à remettre) ou de Momo (à confirmer maintenant).
//   POST { action: 'transfer'|'request', ids }                 (Olivier)
//        { action: 'encode_fourriere', ids, pin }               (Olivier, caisse fourrière)
//        { action: 'confirm', ids, pin } | 'not_received' | 'remind'   (Momo)
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { role, adminView, adminAction, adminEncodeFourriere, momoView, momoConfirm, momoNotReceived, momoRemind } from '@/lib/especes/actions'

export const dynamic = 'force-dynamic'

export async function GET() {
  const u = (await getServerSession(authOptions))?.user as any
  if (!u?.id) return NextResponse.json({ role: null, items: [] })
  const r = await role(u.id)
  if (r === 'admin') {
    // Dernier passage de la mise à jour en échec : Olivier le voit (27/11/2026 : bloquée du 20 au 27/11 sans que personne le sache).
    let panne: string | null = null
    try {
      const { data } = await createAdminClient().from('app_settings').select('value').eq('key', 'especes_last_run').maybeSingle()
      const v = data?.value ? JSON.parse(String(data.value)) : null
      if (v && v.ok === false) panne = `La liste des espèces n’est plus mise à jour depuis le ${new Date(v.depuis || v.at).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} : ${String(v.error || 'erreur inconnue').slice(0, 200)}`
    } catch { /* l'avertissement est un plus */ }
    return NextResponse.json({ role: r, items: await adminView(), panne })
  }
  if (r === 'momo') return NextResponse.json({ role: r, items: await momoView() })
  return NextResponse.json({ role: null, items: [] })
}

export async function POST(req: Request) {
  const u = (await getServerSession(authOptions))?.user as any
  if (!u?.id) return NextResponse.json({ error: 'Non connecté' }, { status: 401 })
  const r = await role(u.id)
  const b = await req.json().catch(() => ({}))
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
  if (!ids.length) return NextResponse.json({ error: 'Aucun paiement' }, { status: 400 })
  if (r === 'admin' && (b.action === 'transfer' || b.action === 'request')) return NextResponse.json({ ok: true, n: await adminAction(ids, b.action) })
  // Caisse fourrière : Olivier encode lui-même, avec son code PIN (23/11/2026).
  if (r === 'admin' && b.action === 'encode_fourriere') return NextResponse.json(await adminEncodeFourriere(u.id, ids, String(b.pin || '')))
  if (r === 'momo' || r === 'admin') {
    // Olivier peut aussi répondre à la place de Momo depuis son écran ? Non : seul Momo confirme la réception.
    if (r === 'momo' && b.action === 'confirm') return NextResponse.json(await momoConfirm(u.id, ids, String(b.pin || '')))
    if (r === 'momo' && b.action === 'not_received') { await momoNotReceived(ids); return NextResponse.json({ ok: true }) }
    if (r === 'momo' && b.action === 'remind') { await momoRemind(ids); return NextResponse.json({ ok: true }) }
  }
  return NextResponse.json({ error: 'Action non permise' }, { status: 403 })
}
