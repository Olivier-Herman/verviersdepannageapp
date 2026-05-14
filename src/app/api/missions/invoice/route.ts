// src/app/api/missions/invoice/route.ts
//
// POST /api/missions/invoice
// Body : { mission_ids: string[]; method: 'manual' | 'auto'; invoice_number?: string; notes?: string }
//
// - method='manual' → invoice_number requis. La/les fiche(s) passent en
//   'completed' avec invoice_number + invoiced_at + invoiced_by. Une tentative
//   de resolution URL Odoo est faite immediatement (best effort, sinon cron).
// - method='auto'   → invoice_number facultatif. La/les fiche(s) passent en
//   'completed' avec invoice_method='auto'.
//
// Verifie acces module 'facturation' ou role admin/superadmin.

import { NextResponse }            from 'next/server'
import { getServerSession }        from 'next-auth'
import { authOptions }             from '@/lib/auth'
import { createAdminClient }       from '@/lib/supabase'
import { resolveInvoiceByNumber }  from '@/lib/odoo-invoice'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60   // PDF + push Odoo via waitUntil peut prendre 30s+

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const role: string = user.role || ''
  const modules: string[] = user.modules || []
  const hasAccess =
    ['admin', 'superadmin'].includes(role) ||
    modules.includes('facturation')
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json() as {
    mission_ids?:    string[]
    method?:         string
    invoice_number?: string
    notes?:          string
  }

  const ids    = Array.isArray(body.mission_ids) ? body.mission_ids.filter(x => typeof x === 'string' && x.length > 0) : []
  const method = body.method === 'manual' || body.method === 'auto' ? body.method : null
  if (ids.length === 0)  return NextResponse.json({ error: 'mission_ids manquant' }, { status: 400 })
  if (!method)            return NextResponse.json({ error: 'method invalide (manual|auto)' }, { status: 400 })

  const cleanedNumber = (body.invoice_number || '').trim() || null
  if (method === 'manual' && !cleanedNumber) {
    return NextResponse.json({ error: 'Numero de facture requis pour method=manual' }, { status: 400 })
  }

  const sb = createAdminClient()

  // Verifie que toutes les missions existent et sont en 'to_invoice'
  const { data: rows, error: fetchErr } = await sb
    .from('incoming_missions')
    .select('id, status, external_id')
    .in('id', ids)
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if ((rows || []).length !== ids.length) {
    return NextResponse.json({ error: 'Une ou plusieurs missions introuvables' }, { status: 404 })
  }
  const notReady = (rows || []).filter(r => r.status !== 'to_invoice')
  if (notReady.length > 0) {
    return NextResponse.json({
      error: `Statut invalide pour : ${notReady.map(r => r.external_id || r.id.slice(0,8)).join(', ')} (attendu: to_invoice)`,
    }, { status: 409 })
  }

  const now = new Date().toISOString()

  // Tentative de resolution URL Odoo (best effort) si on a un numero
  let invoice_odoo_id: number | null = null
  let invoice_url:     string | null = null
  if (cleanedNumber) {
    try {
      const resolved = await resolveInvoiceByNumber(cleanedNumber)
      if (resolved) {
        invoice_odoo_id = resolved.id
        invoice_url     = resolved.url
      }
    } catch (e: any) {
      console.error('[invoice] resolveInvoiceByNumber failed (non bloquant):', e.message)
    }
  }

  const updatePayload: Record<string, any> = {
    status:          'completed',
    invoice_method:  method,
    invoice_number:  cleanedNumber,
    invoice_odoo_id: invoice_odoo_id,
    invoice_url:     invoice_url,
    invoiced_at:     now,
    invoiced_by:     user.id,
  }
  if (body.notes) updatePayload.invoice_notes = body.notes

  const { data: updated, error: updErr } = await sb
    .from('incoming_missions')
    .update(updatePayload)
    .in('id', ids)
    .select('id, status, invoice_method, invoice_number, invoice_url, invoice_odoo_id')
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  // Logs
  const logRows = ids.map(id => ({
    mission_id: id,
    actor_id:   user.id,
    action:     'invoiced',
    notes:      method === 'auto'
      ? 'Auto-facturation validee'
      : `Facturee n° ${cleanedNumber}${invoice_url ? ' (lien Odoo resolu)' : ' (lien Odoo non resolu — cron retry)'}`,
    metadata:   { method, invoice_number: cleanedNumber, invoice_odoo_id, invoice_url },
  }))
  await sb.from('mission_logs').insert(logRows)

  // Attache le PDF resume mission a la facture Odoo (et regenere helpdesk+vehicle
  // si pas encore fait). Si plusieurs missions sont facturees ensemble (chaine
  // REM+REL), on attache UN seul PDF combine a la facture.
  // waitUntil pour survivre au return de la fonction Vercel.
  if (invoice_odoo_id || method === 'auto') {
    const chainIds = ids.length > 1 ? ids : undefined
    const primaryId = ids[0]
    const { waitUntil } = await import('@vercel/functions')
    waitUntil(
      import('@/lib/missions/attach-mission-pdf').then(({ attachMissionPdf }) =>
        attachMissionPdf(primaryId, { chainMissionIds: chainIds })
      ).catch(e => {
        console.error('[mission-pdf] invoice attach échoué (non bloquant):', e.message)
      })
    )
  }

  return NextResponse.json({ ok: true, updated })
}
