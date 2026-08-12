// src/app/api/admin/flux2/route.ts
//
// Grille d'activation du flux 2 : chauffeurs × assistances. Superadmin uniquement.
//   GET  → chauffeurs, assistances (catalogue) et cases cochées
//   POST → coche/décoche UNE case { driverId, assistanceKey, enabled }
// Olivier 2026-08-11.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { invalidateFlux2Cache } from '@/lib/cloture/gating'

export const dynamic = 'force-dynamic'

/** Assistances proposées : celles pour lesquelles une transformation existe ou
 *  viendra. On n'expose pas les 30 sources du catalogue — cocher « garage » ou
 *  « unknown » n'aurait aucun sens tant qu'aucune clôture n'est branchée derrière. */
// Objectif (Olivier 2026-08-12) : le chauffeur voit les MÊMES écrans partout.
// La grille expose donc TOUTES les sources actives du catalogue, pas une liste
// figée — ajouter une assistance ne demande plus de toucher au code. Les
// intégrations qui poussent vraiment chez l'assisteur restent en tête.
const PRIORITY = ['touring', 'vab', 'axa', 'kaze', 'mondial'] as const

// Exclues du flux 2 :
//   • `allianz` — même assistance que `mondial` (cf. alias dans gating.ts) ;
//   • `unknown` — fourre-tout technique ;
//   • `garage_*` — garages partenaires générés automatiquement, un par client ;
//   • `police_*` et `sia_couvert` — LES APPELS POLICE NE CHANGENT PAS (Olivier
//     2026-08-12) : ils ont leur module et leurs écrans dédiés (fiche Siabis,
//     fourrière, encaissement au comptoir). Le flux 2 n'a rien à y faire.
//     ⚠️ Ça ne concerne PAS une mission Touring autoroute reclassée en Siabis :
//     elle garde son lien COMEX, donc son assistance reste `touring`.
const EXCLUDED = (k: string) =>
  k === 'allianz' || k === 'unknown' || k.startsWith('garage_') ||
  k.startsWith('police_') || k === 'sia_couvert'

/** Libellés qui priment sur le catalogue (regroupements, noms d'usage). */
const LABEL_OVERRIDES: Record<string, string> = { mondial: 'Mondial / Allianz' }

async function guard() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const sb = createAdminClient()
  const { data: me } = await sb.from('users').select('id, role, roles').eq('email', session.user.email).maybeSingle()
  const roles = [(me as any)?.role, ...((me as any)?.roles || [])].filter(Boolean) as string[]
  if (!roles.includes('superadmin')) return { error: NextResponse.json({ error: 'Accès refusé' }, { status: 403 }) }
  return { sb, me }
}

export async function GET() {
  const g = await guard(); if ('error' in g) return g.error
  const { sb } = g

  const [{ data: drivers }, { data: cat }, { data: grid }] = await Promise.all([
    // ⚠️ la colonne s'appelle `active`, pas `is_active` : la mauvaise version
    // renvoyait un 400 PostgREST et donc « aucun chauffeur trouvé ».
    sb.from('users').select('id, name, email, role, roles, active')
      .or('role.in.(driver,chauffeur),roles.ov.{driver,chauffeur}')
      .order('name'),
    sb.from('mission_source_catalog').select('key, label, active, sort_order').eq('active', true),
    sb.from('flux2_activation').select('driver_id, assistance_key, enabled'),
  ])

  const keys = (cat || []).map((c: any) => c.key).filter((k: string) => !EXCLUDED(k))
  const labels = new Map((cat || []).map((c: any) => [c.key, c.label]))
  const rank = (k: string) => { const i = (PRIORITY as readonly string[]).indexOf(k); return i < 0 ? 99 : i }
  const assistances = keys
    .sort((x: string, y: string) => rank(x) - rank(y) || String(labels.get(x)).localeCompare(String(labels.get(y))))
    .map((k: string) => ({ key: k, label: LABEL_OVERRIDES[k] || labels.get(k) || k, integrated: rank(k) < 99 }))
  const enabled: Record<string, boolean> = {}
  for (const r of (grid || []) as any[]) if (r.enabled) enabled[`${r.driver_id}|${r.assistance_key}`] = true

  return NextResponse.json({
    assistances,
    drivers: (drivers || []).filter((d: any) => d.active !== false)
      .map((d: any) => ({ id: d.id, name: d.name || d.email })),
    enabled,
  })
}

export async function POST(req: Request) {
  const g = await guard(); if ('error' in g) return g.error
  const { sb, me } = g

  const b = await req.json().catch(() => ({}))
  const driverId = String(b?.driverId || '')
  const key      = String(b?.assistanceKey || '')
  const enabled  = !!b?.enabled
  if (!driverId || !key || EXCLUDED(key)) {
    return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 })
  }
  // La clé doit exister au catalogue : pas de case fantôme.
  const { data: known } = await sb.from('mission_source_catalog').select('key').eq('key', key).maybeSingle()
  if (!known) return NextResponse.json({ error: 'Source inconnue' }, { status: 400 })

  const { error } = await sb.from('flux2_activation').upsert(
    { driver_id: driverId, assistance_key: key, enabled, updated_at: new Date().toISOString(), updated_by: (me as any)?.id },
    { onConflict: 'driver_id,assistance_key' },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  invalidateFlux2Cache()
  return NextResponse.json({ ok: true })
}
