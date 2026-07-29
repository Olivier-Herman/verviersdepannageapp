// src/app/api/cron/auto-accept-comex/route.ts
//
// Auto-validation Touring COMEX BKO (cron horaire). Accepte AUTOMATIQUEMENT les
// dossiers dont le verdict est 'ok' (le tarif Touring MATCHE le tarif VD Soft) —
// donc pas besoin de fenêtre de vérif : le comparatif tarifaire est la sécurité.
// Rejoue le bouton « Accepter » (même endpoint /accept) : écriture COMEX BKO +
// auto-facturation VD Soft. Idempotent (le dossier sort de la file après).
// Olivier 2026-07-29.
//
// La table touring_comex_dossiers est tenue à jour par le cron poll-comex-bko
// (toutes les 3 min) → on lit les verdicts directement, pas de sync ici.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

const BATCH = 25   // borne par passe (chaque accept = login COMEX + écritures)

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Kill-switch : DISABLE_AUTO_ACCEPT_COMEX=true sur Vercel pour mettre en pause.
  if (process.env.DISABLE_AUTO_ACCEPT_COMEX === 'true') {
    return NextResponse.json({ ok: true, disabled: true })
  }
  const baseUrl = process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com'
  const secret  = process.env.NEXTAUTH_SECRET || ''
  const sb = createAdminClient()

  const summary: any = { at: new Date().toISOString() }

  // Dossiers COMEX présents, tarif OK (match) uniquement.
  const { data: rows } = await sb.from('touring_comex_dossiers')
    .select('id, dossier, mission_number')
    .eq('in_comex', true)
    .eq('verdict', 'ok')
    .order('file_date', { ascending: true })
    .limit(BATCH)

  const ids = (rows || []).map(r => r.id)
  if (ids.length === 0) {
    Object.assign(summary, { ok: true, eligible: 0, accepted: 0 })
    await sb.from('app_settings').upsert({ key: 'auto_accept_comex_last_run', value: summary }, { onConflict: 'key' }).then(() => {}, () => {})
    return NextResponse.json(summary)
  }

  try {
    const r = await fetch(`${baseUrl}/api/touring/comex-bko/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({ ids }),
    })
    const j = await r.json().catch(() => ({}))
    Object.assign(summary, {
      ok: r.ok, http: r.status,
      eligible: ids.length,
      accepted: j?.accepted ?? 0,
      results: Array.isArray(j?.results) ? j.results.slice(0, 40) : undefined,
    })
  } catch (e: any) {
    Object.assign(summary, { ok: false, eligible: ids.length, error: String(e?.message || e) })
  }

  await sb.from('app_settings').upsert({ key: 'auto_accept_comex_last_run', value: summary }, { onConflict: 'key' }).then(() => {}, () => {})
  console.log('[auto-accept-comex]', JSON.stringify({ eligible: ids.length, accepted: summary.accepted }))
  return NextResponse.json(summary)
}
