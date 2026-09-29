// src/lib/courrier/match.ts — rattacher un courrier : fiches par plaque, châssis ou
// référence (PV, n° de dossier), procédure retenue pour l'expéditeur, personnes.

import { sourceLabel } from '@/lib/missions/source-catalog'

const COLS = 'id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin, source, status, parc_zone_key, billed_to_name, dossier_number, police_pv_number, created_at, dossier_leg'

const STATUS_LABELS: Record<string, string> = {
  parked: 'en parc', completed: 'terminée', to_invoice: 'à facturer', invoiced: 'facturée', in_progress: 'en cours',
  delivering: 'en livraison', pending: 'en attente', dispatched: 'attribuée', cancelled: 'annulée',
}

export function plateVariants(p: string | null | undefined): string[] {
  const n = String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (n.length < 4) return []
  const out = new Set<string>([n])
  const m = n.match(/^(\d)([A-Z]{3})(\d{3})$/)
  if (m) out.add(`${m[1]}-${m[2]}-${m[3]}`)
  const raw = String(p || '').toUpperCase().trim(); if (raw) out.add(raw)
  return Array.from(out)
}

export async function missionLabel(m: any): Promise<string> {
  const bits = [`Fiche ${m.mission_number}`, m.vehicle_plate, [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' '), await sourceLabel(m.source).catch(() => m.source),
    STATUS_LABELS[m.status] || m.status, m.status === 'parked' && m.parc_zone_key ? `zone ${m.parc_zone_key}` : null, m.billed_to_name ? `client ${m.billed_to_name}` : null]
  return bits.filter(Boolean).join(' · ')
}

/** Fiches candidates (la plus récente d'abord), hors volets miroirs de gardiennage. */
export async function findMissions(sb: any, r: { plate?: string | null; vin?: string | null; reference?: string | null }): Promise<any[]> {
  const found = new Map<string, any>()
  const add = (rows: any[] | null) => { for (const x of rows || []) if (!x.dossier_leg) found.set(x.id, x) }
  const pv = plateVariants(r.plate)
  if (pv.length) add((await sb.from('incoming_missions').select(COLS).in('vehicle_plate', pv).order('created_at', { ascending: false }).limit(8)).data)
  // Châssis et références souvent « enrichis » sur la fiche (« 65359 / VF3…359 »,
  // « SAISIE-6293 / VE.86.L1.406112/2026 ») : on cherche À L'INTÉRIEUR du champ.
  const like = (v: string) => `%${v.replace(/[%_\\]/g, '')}%`
  const vin = String(r.vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (vin.length >= 11) add((await sb.from('incoming_missions').select(COLS).ilike('vehicle_vin', like(vin)).order('created_at', { ascending: false }).limit(5)).data)
  const ref = String(r.reference || '').trim()
  if (ref.length >= 6) {
    add((await sb.from('incoming_missions').select(COLS).ilike('dossier_number', like(ref)).order('created_at', { ascending: false }).limit(5)).data)
    add((await sb.from('incoming_missions').select(COLS).ilike('police_pv_number', like(ref)).order('created_at', { ascending: false }).limit(5)).data)
  }
  return Array.from(found.values()).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 8)
}

/** Recherche libre (correction du rattachement) : plaque, n° de fiche ou de dossier. */
export async function searchMissions(sb: any, q: string): Promise<any[]> {
  const t = q.trim(); if (t.length < 3) return []
  const found = new Map<string, any>()
  const add = (rows: any[] | null) => { for (const x of rows || []) if (!x.dossier_leg) found.set(x.id, x) }
  const pv = plateVariants(t); if (pv.length) add((await sb.from('incoming_missions').select(COLS).in('vehicle_plate', pv).order('created_at', { ascending: false }).limit(8)).data)
  if (/^\d{6,9}$/.test(t)) add((await sb.from('incoming_missions').select(COLS).eq('mission_number', Number(t)).limit(3)).data)
  if (t.length >= 5) add((await sb.from('incoming_missions').select(COLS).ilike('dossier_number', `%${t.replace(/[%_\\]/g, '')}%`).order('created_at', { ascending: false }).limit(5)).data)
  return Array.from(found.values()).slice(0, 8)
}

/** Personnes à qui confier une tâche : tout le monde sauf les chauffeurs. */
export async function officePeople(sb: any): Promise<{ id: string; name: string; role: string }[]> {
  const { data } = await sb.from('users').select('id, name, role, roles, active').eq('active', true).order('name')
  return (data || []).filter((u: any) => u.role !== 'driver' || (u.roles || []).some((r: string) => r !== 'driver')).map((u: any) => ({ id: u.id, name: u.name, role: u.role }))
}
