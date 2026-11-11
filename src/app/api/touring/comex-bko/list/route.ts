// src/app/api/touring/comex-bko/list/route.ts
//
// GET  → dossiers COMEX BKO en attente + rapprochement VD Soft (table cache).
// POST → { action: 'sync' } : force une synchro immédiate (login COMEX + refresh).
// Superadmin uniquement. Olivier 2026-07-27.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { syncComexBko }      from '@/lib/touring/comex-bko-sync'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

async function requireAccess() {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const role: string = user?.role || ''
  const modules: string[] = Array.isArray(user?.modules) ? user.modules : []
  return (['admin', 'superadmin'].includes(role) || modules.includes('facturation')) ? session : null
}

export async function GET() {
  if (!(await requireAccess())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  // On affiche TOUTES les lignes présentes dans COMEX BKO. Le bouton Accepter
  // n'apparaîtra (côté UI) que pour les fiches to_invoice ; les autres montrent
  // le statut VD Soft. Olivier 2026-07-27.
  const { data: allRows } = await sb.from('touring_comex_dossiers')
    .select('*').eq('in_comex', true).order('file_date', { ascending: true })
  // On masque les dossiers dont la mission VD Soft est déjà terminée/facturée :
  // plus rien à faire (ni accepter, ni auto-facturer) → ils n'ont plus leur place
  // dans la liste « à valider ». On garde les to_invoice et les non-rapprochés
  // (mission_status null). Olivier 2026-08-04.
  const DONE = ['completed', 'invoiced']
  const rows = (allRows || []).filter(r => !DONE.includes(r.mission_status))
  const { data: lastSync } = await sb.from('app_settings').select('value').eq('key', 'comex_bko_last_sync').maybeSingle()
  const ls = typeof lastSync?.value === 'string' ? JSON.parse(lastSync.value) : lastSync?.value
  const counts = { total: rows.length, ok: 0, verify: 0, noMatch: 0 }
  for (const r of rows) {
    if (r.verdict === 'ok') counts.ok++
    else if (r.verdict === 'verify') counts.verify++
    else counts.noMatch++
  }
  // R2 (Olivier 11/11/2026) : connexion à Touring coupée → l'écran le dit au lieu d'afficher « 0 en attente ».
  // Coupée = au dernier passage, aucun compte n'a pu se connecter. « Depuis » = dernière fois qu'un dossier a été vu.
  let coupure: { depuis: string | null; erreur: string } | null = null
  if (ls && Array.isArray(ls.errors) && ls.errors.length > 0 && !ls.accounts) {
    const { data: last } = await sb.from('touring_comex_dossiers').select('last_seen_at').order('last_seen_at', { ascending: false }).limit(1).maybeSingle()
    coupure = { depuis: (last as any)?.last_seen_at || null, erreur: String(ls.errors[0]?.error || 'connexion refusée').slice(0, 160) }
  }
  return NextResponse.json({ rows: rows || [], counts, lastSync: ls || null, coupure })
}

export async function POST(req: Request) {
  if (!(await requireAccess())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  if (body?.action !== 'sync') return NextResponse.json({ error: 'action inconnue' }, { status: 400 })
  const sb = createAdminClient()
  try {
    const summary = await syncComexBko(sb)
    await sb.from('app_settings').upsert(
      { key: 'comex_bko_last_sync', value: { at: new Date().toISOString(), ...summary } },
      { onConflict: 'key' },
    ).then(() => {}, () => {})
    return NextResponse.json({ ok: true, ...summary })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'échec sync' }, { status: 502 })
  }
}
