// src/app/api/dossier/[id]/invoice/route.ts
//
// POST { mission_ids: string[] } — facture les groupes cochés du dossier :
// une facture Odoo brouillon par client, créée directement (pas de devis).
// Accès : admin / superadmin / module facturation, ET la Vue dossier ouverte au
// rôle (superadmin seul tant qu'Olivier n'a pas libéré). Olivier 07/09/2026.

import { NextResponse }        from 'next/server'
import { getServerSession }    from 'next-auth'
import { authOptions }         from '@/lib/auth'
import { isPreviewOn }         from '@/lib/feature-flags'
import { invoiceDossierGroups } from '@/lib/dossier/invoice'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role: string = user.role || ''
  const modules: string[] = Array.isArray(user.modules) ? user.modules : []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('facturation')) {
    return NextResponse.json({ error: 'Accès réservé à la facturation.' }, { status: 403 })
  }
  if (role !== 'superadmin' && !(await isPreviewOn('dossier_view', role))) {
    return NextResponse.json({ error: 'Vue dossier non ouverte à ton rôle.' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  const missionIds: string[] = Array.isArray(body.mission_ids) ? body.mission_ids.filter((x: any) => typeof x === 'string') : []
  if (!missionIds.length) return NextResponse.json({ error: 'Aucun groupe coché' }, { status: 400 })
  try {
    const result = await invoiceDossierGroups({ anyMissionId: params.id, missionIds, actorUserId: user.id || null, dryRun: body.dry_run === true })
    return NextResponse.json({ ok: true, ...result })
  } catch (e: any) {
    const msg = String(e?.message || e)
    const status = /Odoo|introuvable \(default_code\)/i.test(msg) ? 502 : 400
    console.error('[dossier/invoice]', msg)
    return NextResponse.json({ error: msg }, { status })
  }
}
