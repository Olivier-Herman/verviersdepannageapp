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
  const { data: rows } = await sb.from('touring_comex_dossiers')
    .select('*').eq('in_comex', true).order('file_date', { ascending: true })
  const { data: lastSync } = await sb.from('app_settings').select('value').eq('key', 'comex_bko_last_sync').maybeSingle()
  const ls = typeof lastSync?.value === 'string' ? JSON.parse(lastSync.value) : lastSync?.value
  const counts = { total: (rows || []).length, ok: 0, verify: 0, noMatch: 0 }
  for (const r of (rows || [])) {
    if (r.verdict === 'ok') counts.ok++
    else if (r.verdict === 'verify') counts.verify++
    else counts.noMatch++
  }
  return NextResponse.json({ rows: rows || [], counts, lastSync: ls || null })
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
