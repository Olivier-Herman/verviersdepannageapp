// Action de la comptable sur une fiche (lien personnel, sans compte) : valider, rouvrir, remarquer.
import { NextResponse } from 'next/server'
import { verifyDossierToken, comptableAction } from '@/lib/compta/dossier'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const dossierId = verifyDossierToken(params.token)
  if (!dossierId) return NextResponse.json({ ok: false, error: 'Lien invalide' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const kind = b?.kind
  if (!['ok', 'reouvert', 'remarque'].includes(kind) || typeof b?.pointId !== 'string') return NextResponse.json({ ok: false, error: 'Demande invalide' }, { status: 400 })
  const r = await comptableAction(dossierId, b.pointId, kind, b.texte)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
