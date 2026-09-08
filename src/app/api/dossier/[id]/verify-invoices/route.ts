// src/app/api/dossier/[id]/verify-invoices/route.ts
//
// POST — « Facturation OK » depuis la Vue dossier (Olivier 08/09/2026) : pour
// les brouillons Odoo du dossier, lit leur état ; s'ils sont confirmés, écrit
// le numéro sur les fiches et les lignes comptables. Même mécanique que le
// cron sync-invoice-urls (toutes les 20 min), mais à la demande.

import { NextResponse }            from 'next/server'
import { getServerSession }        from 'next-auth'
import { authOptions }             from '@/lib/auth'
import { createAdminClient }       from '@/lib/supabase'
import { syncDraftInvoiceNumbers } from '@/lib/odoo-invoice'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const { data: any0 } = await sb.from('incoming_missions').select('id, parent_mission_id').eq('id', params.id).maybeSingle()
  if (!any0) return NextResponse.json({ error: 'Dossier introuvable' }, { status: 404 })
  const rootId = (any0 as any).parent_mission_id || (any0 as any).id
  const { data: rows } = await sb.from('incoming_missions').select('id, invoice_odoo_id, invoice_number').or(`id.eq.${rootId},parent_mission_id.eq.${rootId}`)
  const ids = (rows || []).map((r: any) => r.id)
  const { data: items } = ids.length ? await sb.from('mission_billed_items').select('invoice_odoo_id, invoice_number').in('mission_id', ids) : { data: [] as any[] }
  const draftIds = Array.from(new Set([
    ...(rows || []).filter((r: any) => r.invoice_odoo_id && !r.invoice_number).map((r: any) => Number(r.invoice_odoo_id)),
    ...(items || []).filter((it: any) => it.invoice_odoo_id && !it.invoice_number).map((it: any) => Number(it.invoice_odoo_id)),
  ]))
  if (!draftIds.length) return NextResponse.json({ ok: true, synced: {}, pending: [] , message: 'Aucun brouillon en attente sur ce dossier.' })
  const synced = await syncDraftInvoiceNumbers(sb, draftIds)
  const pending = draftIds.filter(id => !synced[id])
  return NextResponse.json({ ok: true, synced, pending,
    message: Object.keys(synced).length
      ? `Facturation OK : ${Object.values(synced).join(', ')}${pending.length ? ` · ${pending.length} brouillon(s) encore à confirmer dans Odoo` : ''}`
      : `Toujours en brouillon dans Odoo (${pending.map(id => '#' + id).join(', ')}) : confirme la facture dans Odoo, puis reviens ici.` })
}
