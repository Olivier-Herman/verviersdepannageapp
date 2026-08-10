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

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()

  const { data: d } = await sb.from('saisie_dossiers').select('*').eq('id', params.id).maybeSingle()
  if (!d) return NextResponse.json({ error: 'Dossier introuvable' }, { status: 404 })
  if (!d.validation_doc_path) return NextResponse.json({ error: 'État de frais signé manquant — dépose-le d\'abord (scan groupé / lien).' }, { status: 400 })

  // Réquisitoire de la fiche.
  let reqPath: string | null = null
  let missionNumber: number | null = null
  if (d.mission_id) {
    const { data: m } = await sb.from('incoming_missions').select('requisitoire_doc_path, mission_number').eq('id', d.mission_id).maybeSingle()
    reqPath = m?.requisitoire_doc_path || null
    missionNumber = m?.mission_number ?? null
  }
  if (!reqPath) return NextResponse.json({ error: 'Réquisitoire manquant sur la fiche.' }, { status: 400 })

  const [ef, req] = await Promise.all([dl(sb, d.validation_doc_path), dl(sb, reqPath)])
  if (!ef || !req) return NextResponse.json({ error: 'Téléchargement des documents échoué.' }, { status: 500 })

  const comments = `${missionNumber != null ? '#' + missionNumber : (d.dossier_ref || '')}${d.ef_number ? ' - ' + d.ef_number : ''}`.trim()

  const res = await submitJustInvoiceClaim({
    comments,
    etatFrais: ef,
    requisitoire: req,
    etatFraisName: `etat-de-frais-${d.ef_number || d.vehicle_plate || 'saisie'}.pdf`,
    requisitoireName: `requisitoire-${d.vehicle_plate || 'saisie'}.pdf`,
  })
  if (!res.ok) return NextResponse.json({ error: res.error || 'Dépôt refusé', raw: res.raw }, { status: 502 })

  await sb.from('saisie_dossiers').update({
    justinvoice_ref: res.ref || null,
    state: 'justinvoice',
    updated_at: new Date().toISOString(),
  }).eq('id', params.id)

  return NextResponse.json({ ok: true, ref: res.ref })
}
