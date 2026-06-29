// src/app/api/admin/surcharges/sources/route.ts
//
// GET /api/admin/surcharges/sources
// Renvoie la liste des sources utilisees dans les missions (distinct).
// Pour chaque source, ajoute si dispo le label (depuis mission_sources) et le
// nombre de missions historiques (pour aider a prioriser).
//
// Filtre celles deja presentes dans surcharge_clients pour ne pas proposer
// les doublons.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Sources canoniques connues du systeme (liste centralisee — doit rester
// alignee avec SOURCE_LABELS dans DispatchClient.tsx). Permet de proposer
// VAB, Ethias, etc. dans le picker meme si on n'a pas encore recu de
// mission historique de cette source.
const KNOWN_SOURCES: Record<string, string> = {
  touring:                 'Touring',
  allianz:                 'Allianz',
  ethias:                  'Ethias',
  vivium:                  'Vivium',
  axa:                     'AXA',
  ardenne:                 'Ardenne Assistance',
  mondial:                 'Mondial Assistance',
  vab:                     'VAB',
  appel_police_accident:   'Appel Police - Accident',
  prive:                   'Privé',
  garage:                  'Garage',
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['admin', 'superadmin'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = createAdminClient()

  // Sources distinctes utilisees dans les missions historiques
  const { data: missions } = await sb
    .from('incoming_missions')
    .select('source')
    .not('source', 'is', null)
    .limit(5000)

  const counts = new Map<string, number>()
  for (const m of missions || []) {
    const s = (m.source || '').trim()
    if (!s) continue
    counts.set(s, (counts.get(s) || 0) + 1)
  }

  // Mapping mission_sources (label + partner)
  const { data: mappings } = await sb
    .from('mission_sources')
    .select('source, label, odoo_partner_id')

  const mappingMap = new Map<string, { label: string | null; odoo_partner_id: number | null }>()
  for (const m of mappings || []) {
    mappingMap.set(m.source, { label: m.label, odoo_partner_id: m.odoo_partner_id })
  }

  // Catalog = source de vérité pour la DÉNOMINATION (ex. garage_14528a → "Centracar").
  // Olivier 2026-06-29 : mission_sources peut contenir un libellé erroné
  // (garage_14528a y était "Touring"). Le catalog prime sur l'affichage.
  const { data: catalog } = await sb
    .from('mission_source_catalog')
    .select('key, label')
  const catalogMap = new Map<string, string>()
  for (const c of catalog || []) {
    if (c.label) catalogMap.set(c.key, c.label)
  }

  // Clients deja crees (a exclure)
  const { data: existing } = await sb
    .from('surcharge_clients')
    .select('key')
  const existingSet = new Set((existing || []).map(c => c.key))

  // Resultat : sources connues canoniques + celles trouvees dans missions
  // + celles trouvees dans mission_sources, excluant celles deja dans surcharge_clients
  const allSources = new Set<string>([
    ...Object.keys(KNOWN_SOURCES),
    ...counts.keys(),
    ...mappingMap.keys(),
    ...catalogMap.keys(),
  ])

  const result = [...allSources]
    .filter(s => !existingSet.has(s))
    .map(source => ({
      source,
      // Priorité d'affichage : catalog (dénomination canonique) > mission_sources
      // > sources connues > capitalize. Évite "Touring"/ID pour un garage.
      label:           catalogMap.get(source) || mappingMap.get(source)?.label || KNOWN_SOURCES[source] || capitalize(source),
      odoo_partner_id: mappingMap.get(source)?.odoo_partner_id || null,
      mission_count:   counts.get(source) || 0,
    }))
    .sort((a, b) => b.mission_count - a.mission_count || a.label.localeCompare(b.label))

  return NextResponse.json({ sources: result })
}

function capitalize(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}
