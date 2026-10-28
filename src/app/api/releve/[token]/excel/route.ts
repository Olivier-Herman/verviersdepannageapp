// GET /api/releve/<jeton>/excel — liste du relevé au format Excel (28/10/2026).
import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { releveParJeton } from '@/lib/facturation/releves'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const r = await releveParJeton(params.token)
  if (!r) return NextResponse.json({ error: 'Lien inconnu ou expiré.' }, { status: 404 })
  const rows = r.releve.lignes.map(l => ({
    'Facture': l.facture, 'Votre dossier': l.dossier || '', 'Véhicule': l.plaque || '', 'Intervention': l.date || '', 'Prestation': l.prestation || '',
    'Échéance': l.echeance || '', 'Jours de retard': l.retard, 'Montant': l.montant, 'Reste dû': l.reste,
  }))
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Dossiers ouverts')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="Verviers-Depannage-releve-${r.date}.xlsx"`, 'Cache-Control': 'no-store' } })
}
