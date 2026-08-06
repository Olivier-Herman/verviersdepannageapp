// src/app/api/missions/[id]/touring-close/route.ts
//
// Clôture d'une mission Touring COMEX depuis VD Soft (dispatch ou chauffeur beta).
//   GET                  → données d'init du modal (codes Fin de mission dispo, VIN, MEC, statut)
//   GET ?providers=1&... → liste des garages autorisés (dépose +REM)
//   POST                 → exécute la clôture (closeTouringMission) + effets de bord fiche
//
// Gating : dispatch (admin/superadmin/dispatcher) toujours ; côté chauffeur, seuls
// superadmin + Franck (beta) — voir BETA_DRIVER_EMAILS. Olivier 2026-08-06.

import { NextResponse }       from 'next/server'
import { getServerSession }   from 'next-auth'
import { authOptions }        from '@/lib/auth'
import { createAdminClient }  from '@/lib/supabase'
import {
  loginComex, getComexMissionDetail, getComexProviders, closeTouringMission,
} from '@/lib/touring/comex'
import { endMissionLabel, REM_FIN_CODES } from '@/lib/touring/close-presets'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const DISPATCH_ROLES     = ['admin', 'superadmin', 'dispatcher']
const BETA_DRIVER_EMAILS = ['bose4845@gmail.com']   // Franck — beta clôture chauffeur

function parseKeys(raw: string | null): { CID_DOS: string; CID_SEQ_ACTION: string } | null {
  try {
    const c = JSON.parse(raw || '{}')
    const CID_DOS = String(c?.CID_DOS || '').trim()
    const CID_SEQ_ACTION = String(c?.CID_SEQ_ACTION || '').trim()
    return CID_DOS && CID_SEQ_ACTION ? { CID_DOS, CID_SEQ_ACTION } : null
  } catch { return null }
}

// ── GET : init modal OU liste garages ─────────────────────────────────────────
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data: m } = await sb.from('incoming_missions')
    .select('id, source_format, raw_content, vehicle_plate')
    .eq('id', params.id).maybeSingle()
  if (!m) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  if ((m as any).source_format !== 'comex') {
    return NextResponse.json({ error: 'Pas une mission Touring COMEX' }, { status: 400 })
  }
  const keys = parseKeys((m as any).raw_content)
  if (!keys) return NextResponse.json({ error: 'Clés COMEX absentes de la fiche' }, { status: 400 })

  try {
    const comex = await loginComex('user')
    const url = new URL(req.url)

    // Sous-requête : liste des garages (après choix des codes → provider/get).
    if (url.searchParams.get('providers')) {
      const providers = await getComexProviders(comex, keys, {
        cause:  url.searchParams.get('cause')  || '',
        desc:   url.searchParams.get('desc')   || '',
        result: url.searchParams.get('result') || '',
      })
      return NextResponse.json({ providers })
    }

    const dRes: any = await getComexMissionDetail(comex, keys)
    const d = (dRes?.content || dRes || {}) as Record<string, any>
    const finCodes = String(d.LST_CODE_END_MIS || '')
      .split(';').map(s => s.trim()).filter(Boolean)
      .map(code => ({ code, label: endMissionLabel(code), rem: REM_FIN_CODES.has(code) }))

    return NextResponse.json({
      finCodes,
      vin:    d.NUM_CHASSIS || '',
      mecIso: d.D_MEC || '',
      status: d.COD_STATUT_MTR_ACT || '',
      plate:  (m as any).vehicle_plate || '',
      // codes sinistre d'origine (pré-remplissage éventuel côté dispatch)
      sinistre: { cause: d.COD_CAUSE_SIN || '', type: d.COD_TYPE_SIN || '', desc: d.COD_DESC_SIN || '' },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Erreur COMEX' }, { status: 502 })
  }
}

// ── POST : clôture ────────────────────────────────────────────────────────────
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data: actor } = await sb.from('users')
    .select('id, name, role, roles, email')
    .eq('email', session.user.email).maybeSingle()

  const roles = [(actor as any)?.role, ...((actor as any)?.roles || [])].filter(Boolean) as string[]
  const isDispatch   = roles.some(r => DISPATCH_ROLES.includes(r))
  const isBetaDriver = roles.includes('superadmin') || BETA_DRIVER_EMAILS.includes((actor as any)?.email || '')
  if (!isDispatch && !isBetaDriver) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { finCode, cause, desc, result, vin, mecIso, km, comment, toCidIntv, manualAddress, destination } = body || {}
  if (!finCode || !cause || !desc || !result) {
    return NextResponse.json({ error: 'Codes de clôture manquants' }, { status: 400 })
  }

  const { data: m } = await sb.from('incoming_missions')
    .select('id, source_format, raw_content, mission_type')
    .eq('id', params.id).maybeSingle()
  if (!m || (m as any).source_format !== 'comex') {
    return NextResponse.json({ error: 'Pas une mission Touring COMEX' }, { status: 400 })
  }
  const keys = parseKeys((m as any).raw_content)
  if (!keys) return NextResponse.json({ error: 'Clés COMEX absentes' }, { status: 400 })

  const isRem = REM_FIN_CODES.has(String(finCode))

  // Adresse manuelle (libre) : la destination vit dans COMM_FIN_MISSION au format MAN
  // (tous les champs remplis, nom vide → "x"). Garage de la liste → toCidIntv + comment fourni.
  let finalComment = String(comment || '')
  if (isRem && !toCidIntv && manualAddress) {
    const a = manualAddress
    const nom = String(a.nom || '').trim() || 'x'
    finalComment = `// ADRESSE TO REM MAN : ${nom} ${a.rue || 'x'} ${a.num || 'x'} ${a.cp || 'x'} ${a.loc || 'x'} //`
  }

  const r = await closeTouringMission(keys, {
    finCode: String(finCode), cause: String(cause), desc: String(desc), result: String(result),
    vin: vin ?? null, mecIso: mecIso ?? null,
    km: (km === '' || km == null) ? null : Number(km),
    comment: finalComment, toCidIntv: toCidIntv || null,
  })

  if (r.ok) {
    // Effet de bord fiche VD Soft : sur +REM, passer en type remorquage + compléter
    // l'adresse de destination (garde la fiche cohérente). Olivier 2026-08-06.
    if (isRem) {
      const patch: Record<string, any> = { mission_type: 'remorquage' }
      if (destination?.address) {
        patch.destination_address = destination.address
        if (Number.isFinite(destination.lat)) patch.destination_lat = destination.lat
        if (Number.isFinite(destination.lng)) patch.destination_lng = destination.lng
      }
      await sb.from('incoming_missions').update(patch).eq('id', (m as any).id).then(() => {}, () => {})
    }
    await sb.from('mission_logs').insert({
      mission_id: (m as any).id, actor_id: (actor as any)?.id, action: 'touring_closed',
      notes: `Clôture Touring — ${endMissionLabel(String(finCode))} (codes ${cause}/${desc}/${result})${isRem ? ' → remorquage' : ''}`,
      metadata: { finCode, cause, desc, result, toCidIntv: toCidIntv || null, statusBefore: r.statusBefore, statusAfter: r.statusAfter },
    }).then(() => {}, () => {})
  }

  return NextResponse.json(r, { status: r.ok ? 200 : 502 })
}
