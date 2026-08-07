// src/app/api/cron/touring-vr-scan/route.ts
//
// Re-scrutation COMEX du VÉHICULE DE REMPLACEMENT (VR).
//
// Le lieu du VR n'arrive PAS dans le message initial : Touring le renseigne sur
// l'action (rest/Mission/detail/get, champs VR_NOM/VR_RUE/VR_CP/VR_LOC) UNE FOIS
// que l'opérateur Touring a effectué la réservation. Il faut donc re-scruter la
// fiche régulièrement pour capter l'info.
//
// Cadence : chaque minute (vercel.json). On scrute UNIQUEMENT les missions REM
// Touring ACTIVES (avant mise en parc / clôture) avec un VR DEMANDÉ et dont le
// lieu VR n'est pas encore capté. Dès que VR_NOM se remplit → on le stocke et on
// PUSH une notif au chauffeur assigné. On s'arrête quand le lieu est capté, ou
// quand la mission passe en parc / clôturée (hors du filtre de statut).
//
// Olivier 2026-08-07.

import { NextResponse }         from 'next/server'
import { createAdminClient }    from '@/lib/supabase'
import { loginComex, getComexMissionDetail } from '@/lib/touring/comex'
import { sendPushToUser }       from '@/lib/push'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

// Statuts « chauffeur en cours » : on scrute tant qu'on n'est pas en parc/clôture.
const ACTIVE_STATUSES = ['new', 'dispatching', 'assigned', 'accepted', 'in_progress', 'delivering']

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sb = createAdminClient()

  // Candidats : Touring, actif, VR pas encore capté.
  const { data: missions } = await sb.from('incoming_missions')
    .select('id, mission_number, raw_content, assigned_to, touring_vr, status')
    .eq('source', 'touring')
    .in('status', ACTIVE_STATUSES)
    .is('touring_vr_location', null)

  // Filtre « VR demandé » (drapeaux COMEX). On ne martèle COMEX que pour ceux-là.
  const candidates = (missions || []).filter(m => {
    const v: any = m.touring_vr || {}
    return Number(v.vr) >= 1 || Number(v.vr_taxi) >= 1 || Number(v.shuttle_vr) >= 1
  })

  if (!candidates.length) return NextResponse.json({ ok: true, scanned: 0, captured: 0 })

  let session
  try { session = await loginComex('dispatch') }
  catch (e: any) { return NextResponse.json({ error: 'comex_login', detail: String(e?.message || e) }, { status: 502 }) }

  const results: any[] = []
  let captured = 0

  for (const m of candidates) {
    let keys: { CID_DOS: string; CID_SEQ_ACTION: string }
    try {
      const c = JSON.parse(m.raw_content || '{}')
      keys = { CID_DOS: String(c?.CID_DOS || '').trim(), CID_SEQ_ACTION: String(c?.CID_SEQ_ACTION || '').trim() }
    } catch { continue }
    if (!keys.CID_DOS || !keys.CID_SEQ_ACTION) continue

    let d: any
    try {
      const r: any = await getComexMissionDetail(session, keys)
      d = r?.content ? r.content : r
    } catch (e: any) {
      results.push({ mission: m.mission_number, error: String(e?.message || e) })
      continue
    }

    const nom = String(d?.VR_NOM || '').trim()
    if (!nom) { results.push({ mission: m.mission_number, vr: 'pas encore réservé' }); continue }

    const vrLoc = {
      nom,
      rue:  String(d?.VR_RUE || '').trim(),
      num:  String(d?.VR_NUM_RUE || '').trim(),
      cp:   String(d?.VR_CP || '').trim(),
      loc:  String(d?.VR_LOC || '').trim(),
      comm: String(d?.COMM_VR || '').trim(),
      cod:  String(d?.VR_COD_ADRESSE || '').trim(),
      seq:  keys.CID_SEQ_ACTION,
      captured_at: new Date().toISOString(),
    }

    await sb.from('incoming_missions').update({
      touring_vr_location:    vrLoc,
      touring_vr_notified_at: new Date().toISOString(),
      updated_at:             new Date().toISOString(),
    }).eq('id', m.id)

    // Notif chauffeur assigné.
    if (m.assigned_to) {
      const addr = [
        [vrLoc.rue, vrLoc.num].filter(Boolean).join(' '),
        [vrLoc.cp, vrLoc.loc].filter(Boolean).join(' '),
      ].filter(Boolean).join(', ')
      await sendPushToUser(m.assigned_to, {
        title: '🚗 Véhicule de remplacement réservé',
        body:  `À récupérer : ${nom}${addr ? ' — ' + addr : ''}`,
        url:   `/mission/${m.id}`,
        tag:   `vr-${m.id}`,
      }).catch(() => {})
    }

    await sb.from('mission_logs').insert({
      mission_id: m.id, action: 'touring_vr_captured',
      notes: `VR réservé par Touring : ${nom} — ${vrLoc.rue} ${vrLoc.num}, ${vrLoc.cp} ${vrLoc.loc} (seq ${vrLoc.seq}). Notif chauffeur envoyée.`,
      metadata: { vr: vrLoc },
    }).then(() => {}, () => {})

    captured++
    results.push({ mission: m.mission_number, captured: nom })
  }

  return NextResponse.json({ ok: true, scanned: candidates.length, captured, results })
}
