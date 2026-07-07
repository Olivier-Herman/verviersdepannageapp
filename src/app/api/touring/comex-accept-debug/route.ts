// src/app/api/touring/comex-accept-debug/route.ts
//
// Diagnostic superadmin : pour une mission VD Soft liée COMEX, lit l'état RÉEL de
// la mission sur COMEX (statut actuel, camion assigné, champs du détail) SANS rien
// muter. Sert à comprendre pourquoi un accept « OK » de notre côté ne change rien
// côté COMEX (ex. statut resté 03, champs manquants).
//
// GET /api/touring/comex-accept-debug?mission=<uuid>

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { loginComex, listComexMissions, getComexMissionDetail, getComexAddresses, resolveComexDepotCid } from '@/lib/touring/comex'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

// Champs ré-échoés dans l'accept — on vérifie lesquels sont présents/vides dans le
// détail COMEX (un vide peut faire échouer/no-op l'opération côté COMEX).
const ECHO_FIELDS = [
  'COD_PANNE_CAUSE', 'COD_PANNE_RESULT', 'COD_PANNE_DESC', 'NUM_CHASSIS', 'D_MEC', 'MONT_KM',
  'COD_FIN_MISSION', 'BON_AFFILIATION', 'BON_AFFIL_MOP', 'BON_AFFIL_PRD', 'COMM_FIN_MISSION',
  'COD_NON_SAISIE_KM', 'FL_PLAINTE_CLIENT', 'LIB_PLAINTE_CLIENT',
  'TO_COD_ADRESSE', 'TO_NOM', 'TO_RUE', 'TO_NUM_RUE', 'TO_CP', 'TO_LOC', 'ADR_DEPOT_CID_INTV',
]

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const roles: string[] = Array.isArray((session.user as any).roles) ? (session.user as any).roles : ((session.user as any).role ? [(session.user as any).role] : [])
  if (!roles.includes('superadmin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const missionId = (new URL(req.url).searchParams.get('mission') || '').trim()
  if (!missionId) return NextResponse.json({ error: 'mission requis (?mission=<uuid ou n° mission>)' }, { status: 400 })

  const sb = createAdminClient()
  const COLS = 'id, mission_number, source, source_format, raw_content, touring_accepted_at, touring_onroad_at, touring_onspot_at'
  // Accepte l'UUID OU le n° de mission (ex 10052003).
  const isNumber = /^\d+$/.test(missionId)
  const { data: m } = isNumber
    ? await sb.from('incoming_missions').select(COLS).eq('mission_number', Number(missionId)).maybeSingle()
    : await sb.from('incoming_missions').select(COLS).eq('id', missionId).maybeSingle()
  if (!m) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  let cid: any = null
  try { cid = JSON.parse((m as any).raw_content || '{}') } catch { /* */ }
  const CID_DOS = String(cid?.CID_DOS || '').trim()
  const CID_SEQ_ACTION = String(cid?.CID_SEQ_ACTION || '').trim()

  const ficheInfo = {
    mission_number: (m as any).mission_number,
    source:         (m as any).source,
    source_format:  (m as any).source_format,
    CID_DOS, CID_SEQ_ACTION,
    touring_accepted_at: (m as any).touring_accepted_at,
    touring_onroad_at:   (m as any).touring_onroad_at,
    touring_onspot_at:   (m as any).touring_onspot_at,
    mode:           process.env.TOURING_COMEX_MODE || '(absent)',
  }

  if (!CID_DOS) return NextResponse.json({ ok: false, reason: 'raw_content sans CID_DOS', fiche: ficheInfo })

  try {
    const comex = await loginComex('dispatch')
    const missions = await listComexMissions(comex)
    const match = missions.find(x => String(x.CID_DOS).toUpperCase() === CID_DOS.toUpperCase()
      && (!CID_SEQ_ACTION || String(x.CID_SEQ_ACTION) === CID_SEQ_ACTION))
      || missions.find(x => String(x.CID_DOS).toUpperCase() === CID_DOS.toUpperCase())

    if (!match) {
      return NextResponse.json({
        ok: false, reason: 'Mission absente de la liste COMEX (peut-être déjà terminée/hors périmètre)',
        fiche: ficheInfo,
        statutsVisibles: Array.from(new Set(missions.map(x => x.COD_STATUT_MTR))),
      })
    }

    // Statut RÉEL sur COMEX (03=à valider, 04=acceptée, 05=en route, 06=sur place, 07=terminée).
    const listState = {
      COD_STATUT_MTR: match.COD_STATUT_MTR,
      NICKNAME:       match.NICKNAME,        // code camion si assigné (VERVIERS DE-00X)
      CID_SEQ_ACTION: match.CID_SEQ_ACTION,
      TIMING_ACCEPT:  (match as any).TIMING_ACCEPT,
      D_ASSIGN:       (match as any).D_ASSIGN,
    }

    // Détail : présence/vacuité des champs ré-échoés dans l'accept.
    let echo: Record<string, any> = {}
    try {
      const dRes = await getComexMissionDetail(comex, { CID_DOS: match.CID_DOS, CID_SEQ_ACTION: match.CID_SEQ_ACTION })
      const d = (dRes?.content || dRes || {}) as Record<string, any>
      for (const f of ECHO_FIELDS) {
        const v = d[f]
        echo[f] = (v === undefined) ? '⛔ ABSENT' : (v === null || v === '') ? '(vide)' : v
      }
    } catch (e: any) { echo = { error: e.message } }

    // Adresses (adresse/get) — pour trouver ADR_DEPOT_CID_INTV requis par l'accept.
    let addresses: any = null
    let depotCid = ''
    try {
      addresses = await getComexAddresses(comex, { CID_DOS: match.CID_DOS, CID_SEQ_ACTION: match.CID_SEQ_ACTION })
      depotCid  = await resolveComexDepotCid(comex, { CID_DOS: match.CID_DOS, CID_SEQ_ACTION: match.CID_SEQ_ACTION })
    } catch (e: any) { addresses = { error: e.message } }

    const interpretation = match.COD_STATUT_MTR === '03'
      ? '❌ Toujours À VALIDER (03) → l\'accept n\'a PAS été pris en compte par COMEX'
      : match.COD_STATUT_MTR === '04' ? '✅ ACCEPTÉE (04) → l\'accept a fonctionné'
      : match.COD_STATUT_MTR === '05' ? '✅ EN ROUTE (05)'
      : match.COD_STATUT_MTR === '06' ? '✅ SUR PLACE (06)'
      : `statut ${match.COD_STATUT_MTR}`

    return NextResponse.json({ ok: true, fiche: ficheInfo, listState, interpretation, echoFields: echo, depotCid, addresses })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message, fiche: ficheInfo }, { status: 500 })
  }
}
