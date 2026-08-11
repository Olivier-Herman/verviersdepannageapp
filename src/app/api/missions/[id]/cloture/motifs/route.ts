// src/app/api/missions/[id]/cloture/motifs/route.ts
//
// Motifs de clôture pour une branche donnée, avec les 5-6 suggestions de l'IA en
// tête. Appelé APRÈS le choix de l'issue (c'est là qu'on connaît la branche).
// Olivier 2026-08-11.
//
// L'IA vit ici, côté serveur : le client ne reçoit que des clés + libellés, jamais
// un code brut, jamais la clé API.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { flux2Enabled }      from '@/lib/cloture/gating'
import { motifsForBranch }   from '@/lib/cloture/motifs'
import { suggestMotifs }     from '@/lib/cloture/suggest'
import type { Branch }       from '@/lib/cloture/outcomes'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const branch = String(body?.branch || '') as Branch
  if (branch !== 'mobilite' && branch !== 'remorquage') {
    return NextResponse.json({ error: 'Branche invalide' }, { status: 400 })
  }

  const sb = createAdminClient()
  const { data: actor } = await sb.from('users')
    .select('id, role, roles').eq('email', session.user.email).maybeSingle()

  const { data: m } = await sb.from('incoming_missions')
    .select('id, source, source_format, assigned_to, incident_description, vehicle_brand, vehicle_model')
    .eq('id', params.id).maybeSingle()
  if (!m) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  if (!(await flux2Enabled(actor as any, m as any))) {
    return NextResponse.json({ error: 'Flux 2 non activé pour cette mission' }, { status: 403 })
  }

  // Catalogue de la branche — le catch-all « Autre » reste EN DERNIER.
  const motifs = motifsForBranch(branch).map(x => ({
    key: x.key, label: x.label, icon: x.icon, catchAll: x.catchAll,
  }))

  const { keys, via } = await suggestMotifs({
    branch,
    description: (m as any).incident_description,
    brand: (m as any).vehicle_brand,
    model: (m as any).vehicle_model,
  })

  return NextResponse.json({ branch, motifs, suggested: keys, via })
}
