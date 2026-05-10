// ============================================================
// GET /api/relances/history
// ============================================================
// Historique des relances envoyees, ordre sent_at DESC.
// Genere des signed URLs PDF/XLSX a la volee (TTL 1h) pour les liens
// de la page UI — on ne stocke pas les signed URLs en base car elles
// sont generees au moment du send avec TTL 1 an, mais on prefere
// donner ici des liens courts (1h) plus surs pour un usage UI.
//
// Query params :
//   ?partnerId=N : filtre optionnel sur un partner specifique
//   ?limit=N     : default 50, max 200
//
// Reponse :
//   { items: [{ id, partner_id_odoo, partner_name, level, sent_at,
//     sent_by_name, email_to, invoice_count, total_amount, dry_run,
//     graph_message_id, pdf_signed_url, xlsx_signed_url }] }

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'

const TTL_HISTORY_S = 60 * 60   // signed URL 1h pour usage UI rapide
const BUCKET = 'reminders'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const userId   = (session.user as any).id as string
  const supabase = createAdminClient()
  const { data: moduleRow } = await supabase
    .from('user_modules')
    .select('granted')
    .eq('user_id',   userId)
    .eq('module_id', 'relances')
    .eq('granted',   true)
    .maybeSingle()
  if (!moduleRow) return NextResponse.json({ error: 'Module relances non activé' }, { status: 403 })

  const url       = new URL(req.url)
  const partnerId = url.searchParams.get('partnerId')
  const limitRaw  = parseInt(url.searchParams.get('limit') || '50', 10)
  const limit     = Math.min(Math.max(limitRaw, 1), 200)

  // Fetch lignes invoice_reminders + nom user qui a envoye (join users)
  let query = supabase
    .from('invoice_reminders')
    .select(`
      id, partner_id_odoo, partner_name, level, sent_at, email_to,
      invoice_count, total_amount, pdf_url, xlsx_url, graph_message_id,
      dry_run, created_at,
      sent_by:users!invoice_reminders_sent_by_user_id_fkey(name, email)
    `)
    .order('sent_at', { ascending: false })
    .limit(limit)

  if (partnerId) {
    const idNum = parseInt(partnerId, 10)
    if (idNum) query = query.eq('partner_id_odoo', idNum)
  }

  const { data: rows, error } = await query
  if (error) {
    console.error('[relances/history] DB:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Generation signed URLs en parallele (1h TTL)
  const items = await Promise.all((rows || []).map(async row => {
    const sentBy = (row as any).sent_by as { name?: string; email?: string } | null
    const [pdfSigned, xlsxSigned] = await Promise.all([
      row.pdf_url
        ? supabase.storage.from(BUCKET).createSignedUrl(row.pdf_url, TTL_HISTORY_S)
        : Promise.resolve({ data: null, error: null }),
      row.xlsx_url
        ? supabase.storage.from(BUCKET).createSignedUrl(row.xlsx_url, TTL_HISTORY_S)
        : Promise.resolve({ data: null, error: null }),
    ])
    return {
      id:               row.id,
      partner_id_odoo:  row.partner_id_odoo,
      partner_name:     row.partner_name,
      level:            row.level,
      sent_at:          row.sent_at,
      sent_by_name:     sentBy?.name || sentBy?.email || null,
      email_to:         row.email_to,
      invoice_count:    row.invoice_count,
      total_amount:     Number(row.total_amount),
      graph_message_id: row.graph_message_id,
      dry_run:          row.dry_run,
      pdf_signed_url:   pdfSigned.data?.signedUrl || null,
      xlsx_signed_url:  xlsxSigned.data?.signedUrl || null,
    }
  }))

  return NextResponse.json({ items })
}
