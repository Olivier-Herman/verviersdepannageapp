// GET /api/releve/<jeton>/zip — toutes les factures ouvertes du relevé en un ZIP (28/10/2026).
import { NextResponse } from 'next/server'
import JSZip from 'jszip'
import { releveParJeton } from '@/lib/facturation/releves'
import { fetchInvoicePdfFromOdoo } from '@/lib/relances/odoo'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const r = await releveParJeton(params.token)
  if (!r) return NextResponse.json({ error: 'Lien inconnu ou expiré.' }, { status: 404 })
  const zip = new JSZip()
  for (const l of r.releve.lignes) {
    try { zip.file(`${l.facture.replace(/\//g, '-')}${l.dossier ? ` - ${l.dossier.replace(/[\\/:*?"<>|]/g, '-')}` : ''}.pdf`, await fetchInvoicePdfFromOdoo(l.id)) } catch { /* facture sans PDF : ignorée */ }
  }
  const buf = await zip.generateAsync({ type: 'arraybuffer' })
  return new NextResponse(buf, { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="Verviers-Depannage-releve-${r.date}.zip"`, 'Cache-Control': 'no-store' } })
}
