// POST /api/missions/live-action  { token, mission_id, action }
//
// Exécute une action de la Live Activity (App Intent iOS) SANS ouvrir l'app.
// Auth par token signé (pas de cookie). On ne réimplémente PAS la logique : on
// réappelle /api/missions/driver-action avec une auth INTERNE (header secret +
// id du chauffeur du token) → tous les effets de bord (Touring, Odoo, logs) sont
// réutilisés tels quels. Olivier 2026-07-28.

import { NextResponse }      from 'next/server'
import { verifyLiveToken }   from '@/lib/native/liveToken'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

// Seules ces actions sont déclenchables depuis la Live Activity.
const ALLOWED = new Set(['accept', 'on_site', 'load_vehicle'])

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const token     = String(body?.token || '')
  const missionId = String(body?.mission_id || '')
  const action    = String(body?.action || '')

  const claims = verifyLiveToken(token)
  if (!claims) return NextResponse.json({ error: 'Token invalide' }, { status: 401 })
  if (!missionId || !ALLOWED.has(action)) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })

  // Mission de démo : on ne touche à aucune vraie fiche, on écrit juste une trace
  // (prouve que App Intent + token App Group + live-action fonctionnent bout en bout).
  if (missionId === 'demo-mission') {
    try {
      await createAdminClient().from('app_settings').upsert(
        { key: 'live_action_demo_last', value: { at: new Date().toISOString(), action, uid: claims.uid } },
        { onConflict: 'key' },
      )
    } catch { /* best-effort */ }
    return NextResponse.json({ ok: true, demo: true })
  }

  // Appel interne à driver-action, authentifié comme le chauffeur du token.
  const secret = process.env.NEXTAUTH_SECRET || ''
  const url = new URL('/api/missions/driver-action', req.url).toString()
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':     'application/json',
      'x-internal-secret': secret,
      'x-internal-actor':  claims.uid,
    },
    body: JSON.stringify({ mission_id: missionId, action }),
  })
  const j = await r.json().catch(() => ({}))
  return NextResponse.json({ ok: r.ok, ...j }, { status: r.ok ? 200 : (r.status || 500) })
}
