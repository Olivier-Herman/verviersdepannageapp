// GET /api/releve/<jeton>/pdf/<facture> — PDF d'une facture du relevé (lien public du mail aux assistances, 28/10/2026).
// Seulement une facture de CETTE assistance : ouverte aujourd'hui, ou listée dans le relevé envoyé.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { releveParJeton } from '@/lib/facturation/releves'
import { fetchInvoicePdfFromOdoo } from '@/lib/relances/odoo'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { token: string; id: string } }) {
  const r = await releveParJeton(params.token)
  if (!r) return NextResponse.json({ error: 'Lien inconnu ou expiré.' }, { status: 404 })
  const id = Number(params.id)
  let ligne = r.releve.lignes.find(l => l.id === id)
  if (!ligne) {
    const { data } = await createAdminClient().from('releves_assistances').select('invoice_ids').eq('token', params.token).maybeSingle()
    if (!(data?.invoice_ids || []).includes(id)) return NextResponse.json({ error: 'Facture introuvable dans ce relevé.' }, { status: 404 })
  }
  try {
    const pdf = await fetchInvoicePdfFromOdoo(id)
    const nom = `${(ligne?.facture || `facture-${id}`).replace(/\//g, '-')}.pdf`
    return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${nom}"`, 'Cache-Control': 'no-store' } })
  } catch { return NextResponse.json({ error: 'Document momentanément indisponible, réessayez dans quelques minutes.' }, { status: 502 }) }
}
