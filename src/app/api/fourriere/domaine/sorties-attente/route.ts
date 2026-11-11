// src/app/api/fourriere/domaine/sorties-attente/route.ts
//
// GET — ventes d'épaves du Domaine (lues dans les mails par le robot) dont la
// sortie réelle n'est pas encore enregistrée, toutes périodes confondues, une
// ligne par vente. Sert au bloc « Sortir les véhicules vendus » de l'écran
// Domaine (P4, préversion ma_journee, Olivier 11/11/2026). L'enregistrement
// passe par l'action existante set_sortie_vente (ventes-register) : rien de
// neuf côté règles (contrôle de sortie, passage « à facturer »).
// Accès : superadmin (comme l'écran Domaine).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u || u.role !== 'superadmin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const { data, error } = await sb.from('domaine_ventes_epaves')
    .select('id, vente_date, firm, numero, matched_mission_id, sortie_reelle_date')
    .is('sortie_reelle_date', null).not('vente_date', 'is', null)
    .order('vente_date', { ascending: true }).limit(1000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const ids = [...new Set((data || []).map((r: any) => r.matched_mission_id).filter(Boolean))]
  const plates: Record<string, { plate: string | null; status: string | null }> = {}
  if (ids.length) {
    const { data: ms } = await sb.from('incoming_missions').select('id, vehicle_plate, status').in('id', ids)
    for (const m of ms || []) plates[(m as any).id] = { plate: (m as any).vehicle_plate, status: (m as any).status }
  }
  const byVente = new Map<string, { vente: string; firms: Set<string>; lines: number; auParc: number; plates: string[] }>()
  for (const r of data || []) {
    const k = String((r as any).vente_date).slice(0, 10)
    const g = byVente.get(k) || { vente: k, firms: new Set<string>(), lines: 0, auParc: 0, plates: [] }
    g.lines++
    if ((r as any).firm) g.firms.add((r as any).firm)
    const m = (r as any).matched_mission_id ? plates[(r as any).matched_mission_id] : null
    if (m && m.status === 'parked') { g.auParc++; if (m.plate) g.plates.push(m.plate) }
    byVente.set(k, g)
  }
  const ventes = [...byVente.values()].map(g => ({ vente: g.vente, firms: [...g.firms], lines: g.lines, auParc: g.auParc, plates: g.plates.slice(0, 12) }))
  return NextResponse.json({ ok: true, ventes }, { headers: { 'Cache-Control': 'no-store' } })
}
