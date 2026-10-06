// src/lib/especes/actions.ts
//
// Circuit de remise des espèces (Olivier 06/10/2026) :
//   Olivier : « Transférer à Momo » (alerte de Momo du lundi au vendredi, 13 h–14 h) ou
//             « Demander à Momo s'il a reçu » (affiché chez Momo tout de suite) ;
//   Momo    : coche ce qu'il a reçu → « J'ai bien reçu l'argent » + son code PIN →
//             l'argent sort de la caisse du chauffeur dans l'app (transfert de caisse),
//             puis la ligne est encodée dans Scrada ; « Pas reçu » → le jour ouvrable
//             suivant ; « Me le rappeler dans 15 min ».
// L'alerte suit la PERSONNE : elle s'affiche sur les deux comptes de Momo, et une
// confirmation depuis l'un la ferme sur les deux.

import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase'
import { getBusinessList, getBusinessText } from '@/lib/settings/business'
import { encodeCashLine, scradaConfigured } from './scrada'
import { sendPushToUsers } from '@/lib/push'

const TZ = 'Europe/Brussels'
function bxl(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(d).map(x => [x.type, x.value]))
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, wd: String(p.weekday) }
}
/** Instant UTC correspondant à JJ/MM/AAAA hh:00 à Bruxelles. */
function atBxl(y: number, m: number, d: number, h: number): Date {
  const guess = Date.UTC(y, m - 1, d, h)
  const b = bxl(new Date(guess))
  const offset = Date.UTC(b.y, b.m - 1, b.d, b.h, b.min) - guess   // +1 h (hiver) ou +2 h (été)
  return new Date(guess - offset)
}
const isWeekend = (wd: string) => wd === 'Sat' || wd === 'Sun'
/** Prochain jour ouvrable à 13 h (Bruxelles). */
export function nextWorkday13(from = new Date()): Date {
  let t = new Date(from.getTime() + 24 * 3600_000)
  for (let i = 0; i < 7 && isWeekend(bxl(t).wd); i++) t = new Date(t.getTime() + 24 * 3600_000)
  const b = bxl(t); return atBxl(b.y, b.m, b.d, 13)
}
/** Plage de l'alerte « transférés » : du lundi au vendredi, 13 h–14 h (Bruxelles). */
export function inMomoWindow(d = new Date()): boolean { const b = bxl(d); return !isWeekend(b.wd) && b.h === 13 }

export async function role(userId: string): Promise<'admin' | 'momo' | null> {
  const [admins, momo] = await Promise.all([getBusinessList('nav_agents_user_ids').catch(() => [] as string[]), getBusinessList('especes_momo_user_ids').catch(() => [] as string[])])
  if (admins.includes(userId)) return 'admin'
  if (momo.includes(userId)) return 'momo'
  return null
}

const OPEN = ['pending', 'transferred', 'requested']

/** Vue d'Olivier : à remettre, et encodés non rapprochés depuis 3 jours ouvrables (garde-fou). */
export async function adminView() {
  const sb = createAdminClient()
  const { data } = await sb.from('cash_handover_items').select('*').in('status', [...OPEN, 'confirmed', 'encoded', 'flagged']).order('payment_date')
  const now = Date.now()
  const late = (iso: string | null) => { if (!iso) return false; let t = new Date(iso), n = 0; while (t.getTime() < now && n < 10) { t = new Date(t.getTime() + 24 * 3600_000); if (!isWeekend(bxl(t).wd)) n++ } ; return n > 3 }
  return (data || []).map((x: any) => ({ ...x, alerte: ['confirmed', 'encoded'].includes(x.status) && late(x.confirmed_at) }))
}

export async function adminAction(ids: number[], action: 'transfer' | 'request') {
  const sb = createAdminClient()
  const now = new Date().toISOString()
  const patch = action === 'request' ? { status: 'requested', requested_at: now, next_show_at: null, updated_at: now } : { status: 'transferred', transferred_at: now, next_show_at: null, updated_at: now }
  const { data } = await sb.from('cash_handover_items').update(patch).in('odoo_payment_id', ids).in('status', OPEN).select('odoo_payment_id')
  const n = (data || []).length
  // Momo n'a pas forcément VD Soft ouvert : notification sur ses deux comptes (Olivier 06/10/2026).
  // Un transfert hors 13 h–14 h est notifié par la tâche de 13 h (notifyMomoDue).
  if (n && (action === 'request' || inMomoWindow())) await notifyMomo(n).catch(() => {})
  return n
}

export async function notifyMomo(n: number) {
  const ids = await getBusinessList('especes_momo_user_ids').catch(() => [] as string[])
  if (!ids.length) return
  await sendPushToUsers(ids, { title: 'Espèces à confirmer', body: `${n} remise${n > 1 ? 's' : ''} d’espèces à confirmer : ouvre VD Soft.`, url: '/', tag: 'especes-momo' })
}

/** Tâche de 15 min : ce qui devient visible pour Momo depuis le dernier passage (rappel demandé,
 *  « pas reçu » revenu à 13 h, transferts au début de 13 h) → une notification. */
export async function notifyMomoDue(now = new Date()) {
  const sb = createAdminClient()
  const since = now.getTime() - 15 * 60_000
  const { data } = await sb.from('cash_handover_items').select('odoo_payment_id, status, next_show_at, transferred_at').in('status', ['requested', 'transferred'])
  const b = bxl(now)
  const due = (data || []).filter((x: any) => {
    if (x.next_show_at) { const t = new Date(x.next_show_at).getTime(); return t > since && t <= now.getTime() && (x.status === 'requested' || inMomoWindow(now)) }
    return x.status === 'transferred' && inMomoWindow(now) && b.min < 15
  })
  if (due.length) await notifyMomo(due.length)
  return due.length
}

/** Ce que Momo voit maintenant : demandés (à toute heure) + transférés (13 h–14 h en semaine). */
export async function momoView(d = new Date()) {
  const sb = createAdminClient()
  const { data } = await sb.from('cash_handover_items').select('*').in('status', ['requested', 'transferred']).order('payment_date')
  return (data || []).filter((x: any) => (!x.next_show_at || new Date(x.next_show_at) <= d) && (x.status === 'requested' || inMomoWindow(d)))
}

export async function momoNotReceived(ids: number[]) {
  const sb = createAdminClient()
  // « Pas reçu » : le paiement revient le jour ouvrable suivant, dans l'alerte de 13 h.
  await sb.from('cash_handover_items').update({ status: 'transferred', next_show_at: nextWorkday13().toISOString(), updated_at: new Date().toISOString() }).in('odoo_payment_id', ids).in('status', ['requested', 'transferred'])
}

export async function momoRemind(ids: number[]) {
  const sb = createAdminClient()
  const t = new Date(Date.now() + 15 * 60_000)
  const { data } = await sb.from('cash_handover_items').select('odoo_payment_id, status').in('odoo_payment_id', ids)
  for (const x of data || []) {
    // Un « transféré » reste dans la plage 13 h–14 h ; au-delà, jour ouvrable suivant à 13 h.
    const at = x.status === 'transferred' && !inMomoWindow(t) ? nextWorkday13() : t
    await sb.from('cash_handover_items').update({ next_show_at: at.toISOString(), updated_at: new Date().toISOString() }).eq('odoo_payment_id', x.odoo_payment_id)
  }
}

/** Confirmation par PIN : sortie de la caisse du chauffeur, puis encodage Scrada (si activé). */
export async function momoConfirm(userId: string, ids: number[], pin: string): Promise<{ ok: boolean; error?: string; confirmed?: number; encoded?: number; errors?: string[] }> {
  const sb = createAdminClient()
  const since = new Date(Date.now() - 15 * 60_000).toISOString()
  const { count } = await sb.from('especes_pin_failures').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('at', since)
  if ((count || 0) >= 5) return { ok: false, error: 'Trop de codes faux : réessaie dans 15 minutes.' }
  const { data: me } = await sb.from('users').select('id, verify_pin_hash').eq('id', userId).single()
  if (!me?.verify_pin_hash) return { ok: false, error: 'Aucun code PIN sur ce compte.' }
  if (!/^\d{4}$/.test(String(pin)) || !(await bcrypt.compare(String(pin), me.verify_pin_hash))) {
    await sb.from('especes_pin_failures').insert({ user_id: userId })
    return { ok: false, error: 'Code PIN incorrect : rien n’est confirmé.' }
  }
  const receiver = await getBusinessText('especes_receveur_user_id')
  const scradaOn = (await getBusinessText('especes_scrada_actif').catch(() => 'non')).toLowerCase() === 'oui' && scradaConfigured()
  const typeId = scradaOn ? await getBusinessText('scrada_type_paiement_client') : ''
  const { data: items } = await sb.from('cash_handover_items').select('*').in('odoo_payment_id', ids).in('status', ['requested', 'transferred'])
  const out = { ok: true, confirmed: 0, encoded: 0, errors: [] as string[] }
  for (const it of items || []) {
    const now = new Date().toISOString()
    // 1. L'argent sort de la caisse de celui qui l'avait (sauf s'il était déjà chez Momo).
    let transferId: string | null = null
    if (it.holder_user_id && it.holder_user_id !== receiver) {
      const { data: tr, error } = await sb.from('cash_transfers').insert({ sender_id: it.holder_user_id, receiver_id: receiver, amount: it.amount, notes: `Remise d'espèces ${it.payment_name} (${it.invoice || ''} ${it.client || ''}) — confirmée par Momo` }).select('id').single()
      if (error || !tr) { out.errors.push(`${it.payment_name} : ${error?.message || 'transfert impossible'}`); continue }
      const { data: rpc, error: rpcErr } = await sb.rpc('transfer_cash_atomic', { p_transfer_id: tr.id })
      if (rpcErr || !rpc?.ok) { out.errors.push(`${it.payment_name} : ${rpcErr?.message || rpc?.error || 'transfert refusé'}`); continue }
      transferId = tr.id
    }
    await sb.from('cash_handover_items').update({ status: 'confirmed', confirmed_at: now, confirmed_by: userId, cash_transfer_id: transferId, next_show_at: null, updated_at: now }).eq('odoo_payment_id', it.odoo_payment_id)
    out.confirmed++
    // 2. Scrada (date du jour, « Validation Momo du … »).
    if (scradaOn) {
      try {
        const lineId = await encodeCashLine(it, now, typeId)
        await sb.from('cash_handover_items').update({ status: 'encoded', encoded_at: new Date().toISOString(), scrada_line_id: lineId || null, last_error: null }).eq('odoo_payment_id', it.odoo_payment_id)
        out.encoded++
      } catch (e: any) {
        await sb.from('cash_handover_items').update({ last_error: String(e?.message || e).slice(0, 300) }).eq('odoo_payment_id', it.odoo_payment_id)
        out.errors.push(`${it.payment_name} : Scrada — ${e?.message || e}`)
      }
    }
  }
  return out
}
