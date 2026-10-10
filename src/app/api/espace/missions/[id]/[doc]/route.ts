// GET /api/espace/missions/[id]/rapport — rapport d'intervention (mission terminée)
// GET /api/espace/missions/[id]/facture | avoir — facture ou note de crédit validée et envoyée
import { NextResponse } from 'next/server'
import { getEspaceSession } from '@/lib/espace/session'
import { missionVisible, relivraisonsDe, suiviClient } from '@/lib/espace/missions'
import { documentsEnvoyes, idsRapport } from '@/lib/espace/documents'
import { buildRapportData, renderRapportPdf } from '@/lib/missions/rapport-intervention'
import { fetchInvoicePdfFromOdoo } from '@/lib/relances/odoo'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const pdf = (buf: Buffer, nom: string, telecharger: boolean) => new NextResponse(new Uint8Array(buf), {
  headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${telecharger ? 'attachment' : 'inline'}; filename="${nom}"`, 'Cache-Control': 'private, no-store' },
})

export async function GET(req: Request, { params }: { params: { id: string; doc: string } }) {
  const s = await getEspaceSession()
  if (!s) return NextResponse.json({ error: 'Session expirée' }, { status: 401 })
  const m = await missionVisible(params.id, s.compte, s.societes)
  if (!m) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  const dl = new URL(req.url).searchParams.get('dl') === '1'

  if (params.doc === 'rapport') {
    const rel = (await relivraisonsDe([m.id])).get(m.id) || null
    if (suiviClient(m, rel).ton !== 'fini') return NextResponse.json({ error: 'Le rapport sera disponible à la fin de l’intervention.' }, { status: 409 })
    const d = await buildRapportData(await idsRapport(m), null)
    if (!d) return NextResponse.json({ error: 'Rapport indisponible' }, { status: 404 })
    return pdf(await renderRapportPdf(d), `Rapport-intervention-${d.number.replace(/\s+/g, '')}.pdf`, dl)
  }

  if (params.doc === 'facture' || params.doc === 'avoir') {
    const d = (await documentsEnvoyes([m])).get(m.id)
    const f = params.doc === 'facture' ? d?.facture : d?.avoir
    if (!f) return NextResponse.json({ error: 'Ce document n’est pas encore disponible.' }, { status: 404 })
    try {
      return pdf(await fetchInvoicePdfFromOdoo(f.id), `${params.doc === 'avoir' ? 'Note-de-credit' : 'Facture'}-${f.numero.replace(/[^\w.-]/g, '_')}.pdf`, dl)
    } catch {
      return NextResponse.json({ error: 'Document momentanément indisponible.' }, { status: 502 })
    }
  }
  return NextResponse.json({ error: 'Document inconnu' }, { status: 404 })
}
