// src/app/api/requisitoires/[id]/requalify/route.ts
//
// POST /api/requisitoires/[id]/requalify
//   Requalifie un mail (classé « non-réquisitoire » ou « ignoré ») EN réquisitoire :
//   force doc_type=requisitoire, re-scan les candidats (findRequisitoireCandidates)
//   et repasse la ligne en file (pending si clé forte plaque/VIN, sinon to_verify).
//   Utile quand l'IA a mal classé un mail. Olivier 2026-07-06.
//   Accès : admin / superadmin / module fourriere.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { findRequisitoireCandidates } from '@/lib/requisitoire/match'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const role = user?.role || ''
  const modules: string[] = user?.modules || []
  if (!user || (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = createAdminClient()
  const { data: row } = await sb.from('requisitoire_intake')
    .select('id, extracted, doc_type').eq('id', params.id).single()
  if (!row) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  const ex: any = (row as any).extracted || null
  // On conserve le type levée si l'extraction l'avait détecté, sinon réquisitoire.
  const docType = ex?.doc_type === 'levee_saisie' ? 'levee_saisie' : 'requisitoire'

  let candidates: any[] = []
  let confidence = 'none'
  let status = 'to_verify'
  let matched: string | null = null

  if (ex) {
    const match = await findRequisitoireCandidates(sb, { ...ex, doc_type: docType })
    candidates = match.candidates as any
    confidence = match.confidence
    const plateAlnum = String(ex.plaque || '').replace(/[^A-Za-z0-9]/g, '')
    const vinAlnum   = String(ex.vin || '').replace(/[^A-Za-z0-9]/g, '')
    const hasStrongKey = plateAlnum.length >= 4 || vinAlnum.length >= 5
    status  = hasStrongKey ? 'pending' : 'to_verify'
    matched = (status === 'pending' && confidence === 'high') ? (match.best?.mission_id ?? null) : null
  }

  const { error } = await sb.from('requisitoire_intake').update({
    status, doc_type: docType, candidates, confidence, matched_mission_id: matched,
  }).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, status, candidates: candidates.length })
}
