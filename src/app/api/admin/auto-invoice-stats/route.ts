// src/app/api/admin/auto-invoice-stats/route.ts
//
// Statistiques de couverture facturation : combien de missions facturées par le
// SYSTÈME (auto) vs MANUELLEMENT (Jona et les autres), sur une période.
// Superadmin uniquement. Olivier 2026-07-27.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if ((session?.user as any)?.role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const days = Math.min(90, Math.max(1, Number(new URL(req.url).searchParams.get('days') || '30')))
  const since = new Date(Date.now() - days * 86400_000).toISOString()

  const sb = createAdminClient()
  const { data: rows } = await sb.from('incoming_missions')
    .select('auto_invoiced, invoice_created_by, source, mission_type')
    .gte('invoice_created_at', since)
    .not('invoice_created_at', 'is', null)
    .limit(20000)

  let auto = 0
  const manualByUser = new Map<string, number>()
  for (const r of (rows || []) as any[]) {
    if (r.auto_invoiced) auto++
    else manualByUser.set(r.invoice_created_by || 'inconnu', (manualByUser.get(r.invoice_created_by || 'inconnu') || 0) + 1)
  }
  const userIds = [...manualByUser.keys()].filter(id => id !== 'inconnu')
  const { data: users } = userIds.length
    ? await sb.from('users').select('id, name, email').in('id', userIds)
    : { data: [] as any[] }
  const nameById = new Map((users || []).map((u: any) => [u.id, u.name || u.email]))
  const manual = [...manualByUser.entries()]
    .map(([id, count]) => ({ user_id: id, name: id === 'inconnu' ? 'Inconnu' : (nameById.get(id) || id.slice(0, 8)), count }))
    .sort((a, b) => b.count - a.count)

  const manualTotal = manual.reduce((s, m) => s + m.count, 0)
  const total = auto + manualTotal

  // Dernière passe du cron.
  const { data: lr } = await sb.from('app_settings').select('value').eq('key', 'auto_invoice_last_run').maybeSingle()
  const lastRun = (() => { try { const v = lr?.value; return typeof v === 'string' ? JSON.parse(v) : v } catch { return null } })()

  return NextResponse.json({
    days, total, auto, manualTotal, manual,
    auto_pct: total ? Math.round((auto / total) * 100) : 0,
    lastRun,
  })
}
