// src/app/api/francofolies/reconcile/route.ts
//
// Outil de RAPPROCHEMENT Francofolies (superadmin).
//
// Contexte : pendant l'événement, des véhicules ont été rendus via le module
// « encaissement chauffeur » au lieu du bouton « Enlèvement » du module
// Francofolies. Résultat : l'argent est encaissé (et souvent déjà facturé),
// mais la fiche Francofolies reste bloquée en 'parked' (« en attente »).
//
// GET  : liste chaque fiche 'parked' + l'encaissement chauffeur correspondant
//        (par mission liée OU par plaque), pour décider quoi faire.
// POST : clôture une fiche SANS repasser par la facturation (aucun devis/facture
//        Odoo, aucun nouvel encaissement) :
//   - action 'close_reconciled' : encaissement identifié → 'completed' +
//       recopie mode/montant à titre de référence. Zéro doublon.
//   - action 'isolate' : parti sans encaissement identifiable → 'completed' +
//       marqueur 'a_verifier' → sort de « en attente » mais ressort dans le
//       registre/listing, flaggé pour être tranché à la clôture.
//
// Olivier 2026-07-25.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

const norm = (s: string | null) => (s || '').replace(/[-.\s_]/g, '').toUpperCase()

function isSuperadmin(session: any): boolean {
  return !!session && (session.user as any)?.role === 'superadmin'
}

interface Encaissement {
  id: string; mission_id: string | null; plate: string | null
  amount: number | null; payment_mode: string | null
  driver_id: string | null; driver_name: string | null
  service_type: string | null; created_at: string | null
  linked_to_this: boolean
}

/** Trouve les encaissements (interventions) correspondant aux fiches parked. */
async function loadEncaissements(sb: any, parked: any[]) {
  const ids    = parked.map(m => m.id)
  const plates = parked.map(m => m.vehicle_plate).filter(Boolean)
  const [{ data: byMission }, { data: byPlate }] = await Promise.all([
    ids.length    ? sb.from('interventions').select('id, mission_id, plate, amount, payment_mode, driver_id, service_type, created_at').in('mission_id', ids) : Promise.resolve({ data: [] }),
    plates.length ? sb.from('interventions').select('id, mission_id, plate, amount, payment_mode, driver_id, service_type, created_at').in('plate', plates) : Promise.resolve({ data: [] }),
  ])
  const map = new Map<string, any>()
  for (const r of [...(byMission || []), ...(byPlate || [])]) map.set(r.id, r)
  const inters = [...map.values()]
  const drvIds = [...new Set(inters.map(i => i.driver_id).filter(Boolean))]
  const { data: users } = drvIds.length ? await sb.from('users').select('id, name').in('id', drvIds) : { data: [] }
  const nameById = new Map<string, string>((users || []).map((u: any) => [String(u.id), String(u.name || '')]))
  return { inters, nameById }
}

/** Les encaissements correspondant à UNE fiche (plaque normalisée OU mission liée). */
function matchFor(mission: any, inters: any[], nameById: Map<string, string>): Encaissement[] {
  const k = norm(mission.vehicle_plate)
  return inters
    .filter(i => norm(i.plate) === k || i.mission_id === mission.id)
    .map(i => ({
      id: i.id, mission_id: i.mission_id, plate: i.plate,
      amount: i.amount != null ? Number(i.amount) : null,
      payment_mode: i.payment_mode, driver_id: i.driver_id,
      driver_name: (i.driver_id && nameById.get(i.driver_id)) || null,
      service_type: i.service_type, created_at: i.created_at,
      linked_to_this: i.mission_id === mission.id,
    }))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!isSuperadmin(session)) return NextResponse.json({ error: 'Réservé au superadmin' }, { status: 403 })

  const sb = createAdminClient()
  const { data: parked, error } = await sb
    .from('incoming_missions')
    .select('id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, parked_at, amount_to_collect, police_blocked')
    .eq('source', 'francofolies').eq('status', 'parked')
    .order('parked_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { inters, nameById } = await loadEncaissements(sb, parked || [])
  const rows = (parked || []).map((m: any) => {
    const matches = matchFor(m, inters, nameById)
    return {
      id: m.id, mission_number: m.mission_number,
      plate: m.vehicle_plate, brand: m.vehicle_brand, model: m.vehicle_model,
      parked_at: m.parked_at, amount_to_collect: m.amount_to_collect,
      police_blocked: m.police_blocked,
      matches, matched: matches.length > 0,
    }
  })
  return NextResponse.json({
    rows,
    summary: { total: rows.length, matched: rows.filter(r => r.matched).length, unmatched: rows.filter(r => !r.matched).length },
  })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!isSuperadmin(session)) return NextResponse.json({ error: 'Réservé au superadmin' }, { status: 403 })
  const user = session!.user as any

  const body = await req.json().catch(() => ({}))
  const missionId = String(body?.mission_id || '').trim()
  const action    = String(body?.action || '')
  if (!missionId) return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })
  if (!['close_reconciled', 'isolate'].includes(action)) {
    return NextResponse.json({ error: 'action invalide (close_reconciled | isolate)' }, { status: 400 })
  }

  const sb  = createAdminClient()
  const now = new Date().toISOString()

  const { data: m } = await sb.from('incoming_missions')
    .select('id, source, status, vehicle_plate, remarks_general')
    .eq('id', missionId).maybeSingle()
  if (!m) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 })
  if (m.source !== 'francofolies') return NextResponse.json({ error: 'Cette fiche n\'est pas une fiche Francofolies' }, { status: 409 })
  if (m.status !== 'parked') return NextResponse.json({ error: `Fiche déjà traitée (statut=${m.status})` }, { status: 409 })

  // IMPORTANT : on passe en 'completed' (terminal) — PAS 'to_invoice' — pour ne
  // JAMAIS déclencher de facturation Odoo (la facture existe déjà côté encaissement).
  const update: Record<string, any> = { status: 'completed', completed_at: now, updated_at: now }
  let logNote = ''

  if (action === 'close_reconciled') {
    // Retrouver l'encaissement correspondant (mission liée OU plaque).
    const { inters, nameById } = await loadEncaissements(sb, [m])
    const matches = matchFor(m, inters, nameById)
    if (matches.length === 0) {
      return NextResponse.json({ error: 'Aucun encaissement trouvé pour cette fiche — utilise « Isoler ».' }, { status: 409 })
    }
    const enc = matches[0]   // le plus récent
    update.payment_method  = enc.payment_mode || 'reconcilie'
    update.amount_collected = enc.amount ?? null
    const encTxt = `${enc.amount ?? '?'}€ ${enc.payment_mode || '?'} · ${enc.driver_name || enc.driver_id || '?'} · ${(enc.created_at || '').slice(0, 16)}`
    logNote = `Clôturé par rapprochement — encaissement chauffeur déjà réalisé (${encTxt}). Aucune facture Francofolies créée (évite le doublon).`
    update.remarks_general = [m.remarks_general, `[Rapprochement] ${encTxt}`].filter(Boolean).join(' · ')
  } else {
    // isolate : parti mais encaissement non identifié → à trancher à la clôture.
    update.payment_method  = 'a_verifier'
    update.amount_collected = null
    logNote = 'Isolé par rapprochement — véhicule parti sans encaissement identifiable. PAIEMENT À VÉRIFIER à la clôture.'
    update.remarks_general = [m.remarks_general, '[Rapprochement] ⚠️ PAIEMENT À VÉRIFIER (parti sans encaissement identifié)'].filter(Boolean).join(' · ')
  }

  const { error: updErr } = await sb.from('incoming_missions').update(update).eq('id', missionId)
  if (updErr) return NextResponse.json({ error: `Échec mise à jour : ${updErr.message}` }, { status: 500 })

  await sb.from('mission_logs').insert({
    mission_id: missionId, actor_id: user.id,
    action: action === 'close_reconciled' ? 'francofolies_reconcile_close' : 'francofolies_reconcile_isolate',
    notes: logNote,
  }).then(() => {}, () => {})

  return NextResponse.json({ ok: true, action, mission_id: missionId })
}
