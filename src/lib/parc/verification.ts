// src/lib/parc/verification.ts
//
// VÉRIFICATION PHYSIQUE DU PARC (Olivier 08/10/2026). Des fiches payées restent « au parc » alors que le
// véhicule est peut-être parti. AVP et mal garée payés sortent d'office ; pour les accidents, la fourrière
// reçoit un lien personnel (sans compte) : pour chaque véhicule, emplacement théorique et photos, puis
// « Présent » ou « Plus là ». « Plus là » sort la fiche du parc à la date du paiement (gardiennage fermé,
// place libérée). « Présent » ne change rien, la réponse est notée sur la fiche.

import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase'
import { releaseParcAndShift } from '@/lib/parc/release'

type Sb = ReturnType<typeof createAdminClient>
const SECRET = () => process.env.DOSSIER_LINK_SECRET || process.env.NEXTAUTH_SECRET || ''
const b64u = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const sig = (p: string) => b64u(crypto.createHmac('sha256', SECRET()).update(`parc-verif:${p}`).digest()).slice(0, 32)

export function signVerificationToken(id: string): string {
  const p = b64u(Buffer.from(id, 'utf8'))
  return `${p}.${sig(p)}`
}
export function verifyVerificationToken(token: string): string | null {
  const [p, s] = String(token || '').split('.')
  if (!p || !s || !SECRET()) return null
  const want = sig(p)
  if (want.length !== s.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(s))) return null
  const id = Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null
}

export interface VerifItem {
  id: string; mission_id: string; sort: number
  snapshot: { mission_number: number; plate: string | null; vehicle: string; source: string; zone: string | null; row: number | null; slot: number | null; entered: string | null; payment: string | null; photos: string[] }
  exit_date: string | null; answer: 'present' | 'absent' | null; answer_note: string | null; answered_at: string | null; applied_at: string | null; applied_result: string | null
}

export async function loadVerification(sb: Sb, id: string) {
  const { data: v } = await sb.from('parc_verifications').select('*').eq('id', id).maybeSingle()
  if (!v) return null
  const { data: items } = await sb.from('parc_verification_items').select('*').eq('verification_id', id).order('sort')
  return { ...v, items: (items || []) as VerifItem[] }
}

/** Sortie du parc d'un véhicule payé : fiche terminée, gardiennage fermé à `exitIso`, place libérée. */
export async function exitPaidVehicle(sb: Sb, missionId: string, exitIso: string, why: string): Promise<string> {
  const { data: root } = await sb.from('incoming_missions').select('id, status, mission_number').eq('id', missionId).maybeSingle()
  if (!root) return 'fiche introuvable'
  if (root.status !== 'parked') return `déjà sortie (fiche ${root.status})`
  const now = new Date().toISOString()
  const { data: legs } = await sb.from('incoming_missions').select('id').eq('parent_mission_id', missionId).eq('dossier_leg', true).is('parc_exit_at', null)
  for (const l of legs || []) await sb.from('incoming_missions').update({ status: 'completed', parc_exit_at: exitIso, parc_exit_reason: 'restitution', updated_at: now }).eq('id', l.id)
  const { error } = await sb.from('incoming_missions').update({ status: 'completed', completed_at: exitIso, updated_at: now }).eq('id', missionId)
  if (error) return `erreur : ${error.message}`
  try { await releaseParcAndShift(sb, missionId) } catch { /* place : non bloquant */ }
  await sb.from('mission_logs').insert({ mission_id: missionId, action: 'parc_exit_verified', notes: `Sortie du parc au ${exitIso.slice(0, 10).split('-').reverse().join('/')} — ${why}` })
  return `sortie du parc au ${exitIso.slice(0, 10).split('-').reverse().join('/')}`
}

/** Réponse de la fourrière sur un véhicule. « Plus là » sort la fiche (une seule fois). */
export async function answerItem(sb: Sb, verificationId: string, itemId: string, answer: 'present' | 'absent', note?: string): Promise<{ ok: boolean; error?: string; item?: VerifItem }> {
  const { data: it } = await sb.from('parc_verification_items').select('*').eq('id', itemId).eq('verification_id', verificationId).maybeSingle()
  if (!it) return { ok: false, error: 'Véhicule introuvable dans cette liste.' }
  if (it.applied_at && it.answer === 'absent') return { ok: false, error: 'Ce véhicule est déjà sorti du parc.' }
  const now = new Date().toISOString()
  const n = String(note || '').trim().slice(0, 500) || null
  let applied: { applied_at: string | null; applied_result: string | null } = { applied_at: null, applied_result: null }
  if (answer === 'absent') {
    const res = await exitPaidVehicle(sb, it.mission_id, it.exit_date || now, `vérification au parc : véhicule plus là${n ? ` (${n})` : ''}`)
    applied = { applied_at: now, applied_result: res }
  } else {
    await sb.from('mission_logs').insert({ mission_id: it.mission_id, action: 'parc_verified_present', notes: `Vérification au parc : véhicule présent${n ? ` — ${n}` : ''}` })
  }
  const { data: upd } = await sb.from('parc_verification_items').update({ answer, answer_note: n, answered_at: now, ...applied }).eq('id', itemId).select('*').single()
  return { ok: true, item: upd as VerifItem }
}

/** Crée une liste de vérification pour des fiches au parc ; la sortie appliquée sera la date du paiement. */
export async function createVerification(sb: Sb, title: string, rows: { mission_id: string; exit_date: string | null; payment: string | null }[], meta: { sent_to?: string; created_by?: string } = {}): Promise<{ id: string; token: string }> {
  const { data: v, error } = await sb.from('parc_verifications').insert({ title, sent_to: meta.sent_to || null, created_by: meta.created_by || null }).select('id').single()
  if (error) throw new Error(error.message)
  let sort = 0
  for (const r of rows) {
    const { data: m } = await sb.from('incoming_missions').select('mission_number, source, vehicle_plate, vehicle_brand, vehicle_model, parc_zone_key, parc_row_number, parc_slot_index, parked_at, intervention_date, driver_photos').eq('id', r.mission_id).maybeSingle()
    if (!m) continue
    const snapshot = {
      mission_number: m.mission_number, plate: m.vehicle_plate, vehicle: [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' '),
      source: m.source, zone: m.parc_zone_key, row: m.parc_row_number, slot: m.parc_slot_index,
      entered: m.parked_at || m.intervention_date, payment: r.payment,
      photos: (Array.isArray(m.driver_photos) ? m.driver_photos : []).filter((u: any) => typeof u === 'string').slice(0, 8),
    }
    await sb.from('parc_verification_items').insert({ verification_id: v.id, mission_id: r.mission_id, sort: sort++, snapshot, exit_date: r.exit_date })
  }
  return { id: v.id, token: signVerificationToken(v.id) }
}
