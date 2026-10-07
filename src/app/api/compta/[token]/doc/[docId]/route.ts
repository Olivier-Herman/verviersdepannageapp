// Téléchargement d'une pièce d'un dossier comptable, par le lien personnel.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyDossierToken, BUCKET } from '@/lib/compta/dossier'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { token: string; docId: string } }) {
  const dossierId = verifyDossierToken(params.token)
  if (!dossierId) return new NextResponse('Lien invalide', { status: 403 })
  const sb = createAdminClient()
  const { data: doc } = await sb.from('dossier_comptable_docs').select('nom, storage_path, mime, point_id').eq('id', params.docId).maybeSingle()
  if (!doc) return new NextResponse('Pièce introuvable', { status: 404 })
  const { data: p } = await sb.from('dossier_comptable_points').select('dossier_id').eq('id', doc.point_id).maybeSingle()
  if (p?.dossier_id !== dossierId) return new NextResponse('Pièce introuvable', { status: 404 })
  const { data: file, error } = await sb.storage.from(BUCKET).download(doc.storage_path)
  if (error || !file) return new NextResponse('Pièce indisponible', { status: 404 })
  return new NextResponse(Buffer.from(await file.arrayBuffer()), {
    headers: { 'Content-Type': doc.mime, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(doc.nom)}`, 'Cache-Control': 'private, no-store' },
  })
}
