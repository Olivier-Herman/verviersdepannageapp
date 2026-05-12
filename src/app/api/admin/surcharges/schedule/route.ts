// src/app/api/admin/surcharges/schedule/route.ts
//
// PUT /api/admin/surcharges/schedule
// Body: { client_key: string, weekday: 1..7, ranges: [{ hour_start, hour_end, rate_dsp_pct, rate_rem_pct }] }
//
// Remplace toutes les plages existantes de la cellule (client × weekday).
// Pas d'API GET dediee — utiliser le GET global /api/admin/surcharges.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface RangeInput {
  hour_start:   number
  hour_end:     number
  rate_dsp_pct: number | null
  rate_rem_pct: number | null
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['admin', 'superadmin'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    client_key?: string
    weekday?:    number
    ranges?:     RangeInput[]
  }
  const client_key = (body.client_key || '').toLowerCase().trim()
  const weekday    = Number(body.weekday)
  const ranges     = Array.isArray(body.ranges) ? body.ranges : []

  if (!client_key) return NextResponse.json({ error: 'client_key requis' }, { status: 400 })
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
    return NextResponse.json({ error: 'weekday doit etre entre 1 et 7' }, { status: 400 })
  }

  // Validation des plages
  for (const r of ranges) {
    if (!Number.isInteger(r.hour_start) || r.hour_start < 0 || r.hour_start > 23) {
      return NextResponse.json({ error: 'hour_start invalide (0-23)' }, { status: 400 })
    }
    if (!Number.isInteger(r.hour_end) || r.hour_end < 1 || r.hour_end > 24) {
      return NextResponse.json({ error: 'hour_end invalide (1-24)' }, { status: 400 })
    }
    if (r.hour_end <= r.hour_start) {
      return NextResponse.json({ error: 'hour_end doit etre > hour_start' }, { status: 400 })
    }
    if (r.rate_dsp_pct == null && r.rate_rem_pct == null) {
      return NextResponse.json({ error: 'Au moins un taux (DSP ou REM) doit etre rempli' }, { status: 400 })
    }
  }

  const sb = createAdminClient()

  // Verifier que le client existe
  const { data: client } = await sb
    .from('surcharge_clients')
    .select('key')
    .eq('key', client_key)
    .maybeSingle()
  if (!client) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  // Remplacer toutes les plages de la cellule
  const { error: delErr } = await sb
    .from('surcharge_schedules')
    .delete()
    .eq('client_key', client_key)
    .eq('weekday', weekday)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  if (ranges.length > 0) {
    const rows = ranges.map(r => ({
      client_key,
      weekday,
      hour_start:   r.hour_start,
      hour_end:     r.hour_end,
      rate_dsp_pct: r.rate_dsp_pct,
      rate_rem_pct: r.rate_rem_pct,
    }))
    const { error: insErr } = await sb.from('surcharge_schedules').insert(rows)
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
