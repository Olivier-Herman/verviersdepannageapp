// src/app/api/fourriere/saisies/[id]/justinvoice/route.ts
//
// Dépose la créance du dossier sur JustInvoice (POST flux Power Automate).
// Docs : état de frais SIGNÉ (validation_doc_path) → CostState + Approval ;
// réquisitoire (requisitoire_doc_path) → Claim. Comments = #mission - EDF.
// Stocke le n° retour dans justinvoice_ref + passe l'état à 'justinvoice'.
// Accès : admin / superadmin / module fourriere. Olivier 2026-08-10.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { submitJustInvoiceClaim } from '@/lib/justinvoice/claim'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

function canAccess(session: any): boolean {
  if (!session) return false
  const u = session.user as any
  return ['admin', 'superadmin'].includes(u.role || '') || (u.modules || []).includes('fourriere')
}

async function dl(sb: any, path: string): Promise<Buffer | null> {
  const { data } = await sb.storage.from('mission-remarks').download(path)
  if (!data) return null
  return Buffer.from(await data.arrayBuffer())
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const efId = (await req.json().catch(() => ({})))?.ef_id || null

  const { data: d } = await sb.from('saisie_dossiers').select('*').eq('id', params.id).maybeSingle()
  if (!d) return NextResponse.json({ error: 'Dossier introuvable' }, { status: 404 })

  // On dépose l'état de frais ciblé (ef_id) ou, à défaut, le + ancien 'accepte'.
  const q = sb.from('saisie_etats_frais').select('id, numero, validation_doc_path, status').eq('dossier_id', params.id)
  const { data: efRow } = efId
    ? await q.eq('id', efId).maybeSingle()
    : await q.eq('status', 'accepte').order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (!efRow) return NextResponse.json({ error: 'Aucun état de frais accepté à déposer (scanne d\'abord le retour signé).' }, { status: 400 })
  if (efRow.status !== 'accepte') return NextResponse.json({ error: `Cet état de frais est « ${efRow.status} », pas « accepté ».` }, { status: 400 })
  if (!efRow.validation_doc_path) return NextResponse.json({ error: 'État de frais signé manquant sur cet état de frais.' }, { status: 400 })

  // Réquisitoire de la fiche.
  let reqPath: string | null = null
  let missionNumber: number | null = null
  if (d.mission_id) {
    const { data: m } = await sb.from('incoming_missions').select('requisitoire_doc_path, mission_number').eq('id', d.mission_id).maybeSingle()
    reqPath = m?.requisitoire_doc_path || null
    missionNumber = m?.mission_number ?? null
  }
  if (!reqPath) return NextResponse.json({ error: 'Réquisitoire manquant sur la fiche.' }, { status: 400 })

  const [ef, reqBuf] = await Promise.all([dl(sb, efRow.validation_doc_path), dl(sb, reqPath)])
  if (!ef || !reqBuf) return NextResponse.json({ error: 'Téléchargement des documents échoué.' }, { status: 500 })

  const comments = `${missionNumber != null ? '#' + missionNumber : (d.dossier_ref || '')}${efRow.numero ? ' - ' + efRow.numero : ''}`.trim()

  const res = await submitJustInvoiceClaim({
    comments,
    etatFrais: ef,
    requisitoire: reqBuf,
    etatFraisName: `etat-de-frais-${efRow.numero || d.vehicle_plate || 'saisie'}.pdf`,
    requisitoireName: `requisitoire-${d.vehicle_plate || 'saisie'}.pdf`,
  })
  if (!res.ok) return NextResponse.json({ error: res.error || 'Dépôt refusé', raw: res.raw }, { status: 502 })

  const now = new Date().toISOString()
  await sb.from('saisie_etats_frais').update({ status: 'depose', justinvoice_ref: res.ref || null }).eq('id', efRow.id)
  await sb.from('saisie_dossiers').update({ justinvoice_ref: res.ref || null, state: 'justinvoice', updated_at: now }).eq('id', params.id)

  return NextResponse.json({ ok: true, ref: res.ref, numero: efRow.numero })
}
