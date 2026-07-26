// POST /api/missions/live-action  { token, mission_id, action }
//
// Exécute une action de la Live Activity (App Intent iOS) SANS ouvrir l'app.
// Auth par token signé (pas de cookie). On ne réimplémente PAS la logique : on
// réappelle /api/missions/driver-action avec une auth INTERNE (header secret +
// id du chauffeur du token) → tous les effets de bord (Touring, Odoo, logs) sont
// réutilisés tels quels. Olivier 2026-07-28.

import { NextResponse }         from 'next/server'
import { verifyLiveToken }      from '@/lib/native/liveToken'
import { createAdminClient }    from '@/lib/supabase'
import { sendLiveActivityApns } from '@/lib/native/pushLiveActivity'
import type { MissionLAState }  from '@/lib/native/liveActivity'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

// Seules ces actions sont déclenchables depuis la Live Activity.
const ALLOWED = new Set(['accept', 'on_site', 'load_vehicle'])

// États affichés par la Live Activity de DÉMO selon l'action tapée (pour valider
// le push temps réel sans vraie mission).
const DEMO_STATE: Record<string, MissionLAState> = {
  accept:       { step: 'enroute', title: "En route vers l'intervention", address: 'Rue de Limbourg 2, Verviers', badgeText: 'EN ROUTE',  accent: 'green' },
  on_site:      { step: 'onsite',  title: 'Sur place — chargez le véhicule', address: 'Rue de Limbourg 2, Verviers', badgeText: 'SUR PLACE', accent: 'amber' },
  load_vehicle: { step: 'loaded',  title: 'En route vers la destination',     address: 'Car Avenue, Eupen',         badgeText: 'LIVRAISON', accent: 'green' },
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const token     = String(body?.token || '')
  const missionId = String(body?.mission_id || '')
  const action    = String(body?.action || '')

  const claims = verifyLiveToken(token)
  if (!claims) return NextResponse.json({ error: 'Token invalide' }, { status: 401 })
  if (!missionId || !ALLOWED.has(action)) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })

  // Mission de démo : on ne touche à aucune vraie fiche. On écrit une trace ET on
  // pousse une MAJ de la Live Activity (prouve le push temps réel bout en bout).
  if (missionId === 'demo-mission') {
    const sb = createAdminClient()

    // Push la nouvelle bannière (l'état dépend de l'action tapée).
    // app_settings.value = TEXTE JSON → parser avant de lire .token.
    let pushed: any = { ok: false, reason: 'no demo token' }
    try {
      const { data } = await sb.from('app_settings').select('value').eq('key', 'live_activity_demo_token').maybeSingle()
      const raw = data?.value
      const val = typeof raw === 'string' ? JSON.parse(raw) : raw
      const token = (val as any)?.token as string | undefined
      if (token) pushed = await sendLiveActivityApns(token, { event: 'update', contentState: DEMO_STATE[action], staleSeconds: 3600 })
    } catch (e: any) { pushed = { ok: false, reason: e?.message || 'err' } }

    try {
      await sb.from('app_settings').upsert(
        { key: 'live_action_demo_last', value: { at: new Date().toISOString(), action, uid: claims.uid, pushed } },
        { onConflict: 'key' },
      )
    } catch { /* best-effort */ }

    return NextResponse.json({ ok: true, demo: true, pushed })
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
  // La MAJ de la bannière est faite par driver-action (synchro à chaque transition).
  return NextResponse.json({ ok: r.ok, ...j }, { status: r.ok ? 200 : (r.status || 500) })
}
