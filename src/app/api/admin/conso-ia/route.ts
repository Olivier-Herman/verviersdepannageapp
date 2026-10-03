// src/app/api/admin/conso-ia/route.ts
//
// Consommation d'IA (table conso_ia) : par fonction et par jour, sur N jours
// (7 par défaut, 30 max). Superadmin. Olivier 03/10/2026.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  const roles: string[] = Array.isArray(u?.roles) ? u.roles : []
  if (!u || (u.role !== 'superadmin' && !roles.includes('superadmin'))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const days = Math.min(30, Math.max(1, Number(new URL(req.url).searchParams.get('jours')) || 7))
  const since = new Date(Date.now() - days * 864e5).toISOString()
  const sb = createAdminClient()
  const rows: any[] = []
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await sb.from('conso_ia').select('at, fonction, declencheur, modele, cout_usd, ok').gte('at', since).order('id').range(from, from + 999)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    rows.push(...(data || [])); if (!data || data.length < 1000) break
  }
  const byFn = new Map<string, { fonction: string; appels: number; erreurs: number; cout: number; declencheurs: Set<string>; modeles: Set<string> }>()
  const byDay = new Map<string, { jour: string; appels: number; cout: number }>()
  for (const r of rows) {
    const f = byFn.get(r.fonction) || { fonction: r.fonction, appels: 0, erreurs: 0, cout: 0, declencheurs: new Set(), modeles: new Set() }
    f.appels++; if (!r.ok) f.erreurs++; f.cout += Number(r.cout_usd) || 0
    if (r.declencheur) f.declencheurs.add(r.declencheur); if (r.modele) f.modeles.add(r.modele)
    byFn.set(r.fonction, f)
    const d = new Date(r.at).toLocaleDateString('fr-CA', { timeZone: 'Europe/Brussels' })
    const g = byDay.get(d) || { jour: d, appels: 0, cout: 0 }; g.appels++; g.cout += Number(r.cout_usd) || 0; byDay.set(d, g)
  }
  return NextResponse.json({
    ok: true, jours: days, total: { appels: rows.length, cout: rows.reduce((s, r) => s + (Number(r.cout_usd) || 0), 0) },
    fonctions: [...byFn.values()].map(f => ({ ...f, declencheurs: [...f.declencheurs], modeles: [...f.modeles] })).sort((a, b) => b.cout - a.cout),
    jours_detail: [...byDay.values()].sort((a, b) => b.jour.localeCompare(a.jour)),
  })
}
