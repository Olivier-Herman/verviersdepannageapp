// src/app/api/fourriere/policiers-a-encoder/route.ts
//
// Onglet « Policiers à encoder » de l'écran Réquisitoires (Olivier 27/11/2026) :
// véhicules au parc sans réquisitoire, avec le policier de la fiche et une remarque libre.
//   GET              → la liste (zone de police déduite du lieu d'enlèvement quand elle manque)
//   POST { id, officer_name, remarque, relancer }
//                    → écrit le policier (officer_name) et la remarque sur la fiche.
// Relances : le robot des saisies relie un nom de policier à son contact police et relance
// le réquisitoire au passage suivant. « relancer » décide donc requisitoire_stop sur la fiche
// (décoché = nom enregistré, relances coupées).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sessionAccess }     from '@/lib/access'
import { sourcesWithTag }    from '@/lib/missions/source-catalog'
import { PARC_STATUSES }     from '@/lib/requisitoire/relance-items'

export const dynamic = 'force-dynamic'

/** Communes et sections de la zone de police Vesdre (Verviers, Dison, Pepinster). */
const VESDRE = /verviers|dison|pepinster|heusy|ensival|lambermont|petit[- ]rechain|stembert|andrimont|wegnez|soiron|cornesse|goffontaine|\b48(00|01|02|20|21|60|61)\b/i
const LEGACY = ['legacy_odoo', 'legacy_towsoft_migration']

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!sessionAccess(session, { roles: ['admin', 'superadmin'], modules: ['fourriere'] }).ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const sb = createAdminClient()
  const sources = [...(await sourcesWithTag('requisitoire')), ...LEGACY]
  const { data, error } = await sb.from('incoming_missions')
    .select('id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, source, police_zone, incident_address, parked_at, created_at, parc_zone_key, billed_to_name, officer_name, officer_partner_id, requisitoire_stop, requisitoire_reminder_count, fourriere_remarque')
    .in('source', sources).in('status', PARC_STATUSES).eq('dossier_leg', false)
    .is('requisitoire_at', null).is('requisitoire_doc_path', null)
    .order('id', { ascending: true }).limit(1000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rows = data || []

  // Dernière fois que le véhicule a été vu au contrôle du parc (scan ou relevé de Verviers).
  const vu: Record<string, { at: string; releve: boolean }> = {}
  const ids = rows.map(r => r.id)
  for (let i = 0; i < ids.length; i += 200) {
    const { data: it } = await sb.from('parc_controle_items').select('mission_id, scanned_at, via').in('mission_id', ids.slice(i, i + 200)).not('scanned_at', 'is', null)
    for (const x of it || []) if (!vu[x.mission_id] || x.scanned_at > vu[x.mission_id].at) vu[x.mission_id] = { at: x.scanned_at, releve: x.via === 'releve' }
  }

  const items = rows.map(r => {
    const adresse = String(r.incident_address || '').replace(/gps:.*$/i, '').replace(/Code Postal:\s*\d+/i, '').replace(/,\s*Belgium/i, '').replace(/\s+/g, ' ').trim().replace(/,$/, '')
    const zone = r.police_zone || (VESDRE.test(r.incident_address || '') ? 'Police Zone Vesdre' : null)
    const requerant = r.billed_to_name && !/commissariat|prefecture|police|zone|options/i.test(r.billed_to_name) ? r.billed_to_name : null
    return {
      id: r.id, fiche: r.mission_number, plaque: r.vehicle_plate, vehicule: [r.vehicle_brand, r.vehicle_model].filter(Boolean).join(' ') || null,
      ancienne: LEGACY.includes(r.source || ''), zone, zone_deduite: !r.police_zone && !!zone, adresse: adresse || null,
      entree: r.parked_at || r.created_at, zone_parc: r.parc_zone_key, requerant,
      policier: r.officer_name || '', policier_relie: !!r.officer_partner_id,
      relances: !r.requisitoire_stop && !!r.officer_partner_id, relances_coupees: !!r.requisitoire_stop, nb_relances: r.requisitoire_reminder_count || 0,
      remarque: r.fourriere_remarque || '', vu: vu[r.id] || null,
    }
  }).sort((a, b) => String(a.entree || '').localeCompare(String(b.entree || '')))
  return NextResponse.json({ items })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const acc = sessionAccess(session, { roles: ['admin', 'superadmin'], modules: ['fourriere'] })
  if (!acc.ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const b = await req.json().catch(() => ({} as any))
  const id = String(b.id || '')
  if (!id) return NextResponse.json({ error: 'Fiche manquante' }, { status: 400 })
  const sb = createAdminClient()
  const { data: m } = await sb.from('incoming_missions').select('id, officer_name, officer_partner_id, requisitoire_stop, fourriere_remarque').eq('id', id).maybeSingle()
  if (!m) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 })

  const nom = String(b.officer_name ?? '').trim().replace(/\s+/g, ' ')
  const remarque = String(b.remarque ?? '').trim()
  const relancer = !!b.relancer
  const patch: Record<string, any> = { fourriere_remarque: remarque || null, requisitoire_stop: !relancer, updated_at: new Date().toISOString() }
  const nomChange = nom !== String(m.officer_name || '').trim()
  if (nomChange) {
    patch.officer_name = nom || null
    // Autre policier : l'ancien contact ne vaut plus, le robot reliera le nouveau nom.
    patch.officer_partner_id = null
  }
  const { error } = await sb.from('incoming_missions').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const notes: string[] = []
  if (nomChange) notes.push(nom ? `Policier encodé : ${nom}` : 'Policier retiré de la fiche')
  if (remarque !== String(m.fourriere_remarque || '').trim()) notes.push(remarque ? `Remarque : ${remarque}` : 'Remarque effacée')
  if (!!m.requisitoire_stop !== !relancer) notes.push(relancer ? 'Relances du réquisitoire activées' : 'Relances du réquisitoire coupées')
  if (notes.length) await sb.from('mission_logs').insert({ mission_id: id, action: 'note', notes: notes.join(' · '), actor_id: acc.id || null }).then(() => {}, () => {})
  return NextResponse.json({ ok: true, policier: nom, policier_relie: nomChange ? false : !!m.officer_partner_id, remarque, relances_coupees: !relancer })
}
