// src/app/api/fourriere/saisies/[id]/validation-upload/route.ts
//
// Dépôt DIRECT (interne) du retour signé d'un dossier saisie — pour les retours
// papier isolés (sans passer par le scan groupé). Stocke le doc signé, passe le
// dossier en 'accepte' (ou 'refuse'). Accès : admin/superadmin/module fourriere.
// Olivier 2026-08-10.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { enregistrerRetourSigne } from '@/lib/saisies/retour-signe'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30
const MAX = 15 * 1024 * 1024

function canAccess(session: any): boolean {
  if (!session) return false
  const u = session.user as any
  return ['admin', 'superadmin'].includes(u.role || '') || (u.modules || []).includes('fourriere')
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const userId = (session!.user as any).id || null
  const sb = createAdminClient()

  const form = await req.formData().catch(() => null)
  const file = form?.get('file') as File | null
  const refus = String(form?.get('refus') || '') === 'true'
  const efId  = String(form?.get('ef_id') || '') || null
  if (!file || file.size === 0) return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 })
  if (file.size > MAX) return NextResponse.json({ error: 'Fichier trop volumineux (max 15 MB)' }, { status: 400 })

  const r = await enregistrerRetourSigne(sb, { dossierId: params.id, efId, contenu: new Uint8Array(await file.arrayBuffer()), nom: file.name, type: file.type, refus, userId, origine: 'dépôt manuel' })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  const deposit = r.deposit
  return NextResponse.json({ ok: true, deposit })
}
