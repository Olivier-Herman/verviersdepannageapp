// GET /api/garage/missions/[id]/document-pdf?type=invoice|credit_note
//   → proxifie le PDF de la facture (out_invoice) ou de la note de crédit
//     (out_refund) d'une mission garage. Le garage n'a pas d'accès Odoo : le PDF
//     est récupéré côté serveur via la clé API partagée de l'app puis streamé.
// Olivier 2026-07-15.

import { NextResponse }          from 'next/server'
import { getServerSession }      from 'next-auth'
import { authOptions }           from '@/lib/auth'
import { createAdminClient }     from '@/lib/supabase'
import { resolveMissionDocs }    from '@/lib/garage/mission-documents'
import { fetchInvoicePdfFromOdoo } from '@/lib/relances/odoo'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

async function getCurrentPartnerId(userId: string): Promise<string | null> {
  const sb = createAdminClient()
  const { data } = await sb
    .from('garage_user_partners')
    .select('garage_partner_id, last_selected_at, is_default, garage_partners ( active )')
    .eq('user_id', userId)
  const links = (data || []).filter(l => (l as any).garage_partners?.active)
  if (links.length === 0) return null
  links.sort((a, b) => {
    if (a.last_selected_at && b.last_selected_at) return b.last_selected_at!.localeCompare(a.last_selected_at!)
    if (a.last_selected_at) return -1
    if (b.last_selected_at) return 1
    if (a.is_default && !b.is_default) return -1
    if (b.is_default && !a.is_default) return 1
    return 0
  })
  return links[0].garage_partner_id
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ((session.user as any).role !== 'garage') return NextResponse.json({ error: 'Reserve garage' }, { status: 403 })

  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'Pas d identite' }, { status: 401 })

  const type = new URL(req.url).searchParams.get('type') === 'credit_note' ? 'credit_note' : 'invoice'

  const partnerId = await getCurrentPartnerId(userId)
  if (!partnerId) return NextResponse.json({ error: 'Aucune entite active' }, { status: 403 })

  const sb = createAdminClient()
  const { data: partner } = await sb
    .from('garage_partners').select('source_key').eq('id', partnerId).maybeSingle()
  const sourceKey = (partner?.source_key || '').trim()

  const { data: mission } = await sb
    .from('incoming_missions')
    .select('id, source, requested_by_garage_id, odoo_quote_id, invoice_odoo_id')
    .eq('id', params.id)
    .maybeSingle()
  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  // Appartenance : la mission relève de la source du garage OU a été demandée par lui.
  const owned = (sourceKey && mission.source === sourceKey) || mission.requested_by_garage_id === partnerId
  if (!owned) return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })

  const docs = await resolveMissionDocs(mission)
  const ref  = type === 'credit_note' ? docs.creditNote : docs.invoice
  if (!ref) return NextResponse.json({ error: 'Document indisponible' }, { status: 404 })

  try {
    const pdf = await fetchInvoicePdfFromOdoo(ref.id)
    const filename = `${type === 'credit_note' ? 'note-de-credit' : 'facture'}-${(ref.number || ref.id).toString().replace(/[^\w.-]/g, '_')}.pdf`
    return new NextResponse(pdf as any, {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control':       'private, max-age=60',
      },
    })
  } catch (e: any) {
    console.error('[garage/document-pdf] PDF KO:', e?.message)
    return NextResponse.json({ error: 'PDF indisponible' }, { status: 502 })
  }
}
