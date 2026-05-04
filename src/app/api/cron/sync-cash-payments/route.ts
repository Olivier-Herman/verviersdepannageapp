// src/app/api/cron/sync-cash-payments/route.ts
// Cron toutes les 30 min — synchronise les paiements espèces Odoo (DEP1 + FOU1) vers la caisse app.
//
// Logique en 3 phases :
//   A. DÉTECTION  : crée des cash_register en 'pending' pour chaque nouveau paiement Odoo espèces
//                   non encore présent (dédup via odoo_payment_id UNIQUE).
//   B. CONFIRMATION : transforme les pending vieux de + 30 min en 'confirmed' après re-vérification
//                     (méthode toujours espèces + journal valide + state paid). Si la re-vérif échoue,
//                     le mouvement pending est SUPPRIMÉ (le paiement Odoo a changé de mode ou a été annulé).
//   C. LOGGING + alerte mail en cas d'erreur fatale.

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient }         from '@/lib/supabase'
import { sendEmail }                 from '@/lib/emails'

const ODOO_URL     = process.env.ODOO_URL!
const ODOO_DB      = process.env.ODOO_DB!
const ODOO_UID     = parseInt(process.env.ODOO_UID || '8', 10)
const ODOO_API_KEY = process.env.ODOO_API_KEY!

const CASH_JOURNAL_IDS = [13, 14]                       // DEP1 + FOU1
const PENDING_DELAY_MIN = 30                             // délai avant confirmation
const NOTIFY_EMAIL = process.env.TOWSOFT_ERROR_NOTIFY_EMAIL || 'info@olivierherman.be'

// ── JSON-RPC Odoo ──────────────────────────────────────────
async function odooRpc<T = any>(model: string, method: string, args: any[] = [], kwargs: object = {}): Promise<T> {
  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call', id: Date.now(),
      params: {
        service: 'object', method: 'execute_kw',
        args: [ODOO_DB, ODOO_UID, ODOO_API_KEY, model, method, args, kwargs],
      },
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Odoo [${model}.${method}] ${JSON.stringify(data.error?.data?.message ?? data.error)}`)
  return data.result
}

// ── Récupérer les payment_method_line_ids correspondant aux "Espèces" sur DEP1 + FOU1 ──
// On filtre dynamiquement (le nom est en français côté config Odoo : "Espèces (Dépannage Caisse)" / "Espèces (Fourrière Caisse)").
async function getEspecesLineIds(): Promise<number[]> {
  const lines = await odooRpc<any[]>(
    'account.payment.method.line',
    'search_read',
    [[['journal_id', 'in', CASH_JOURNAL_IDS], ['name', 'ilike', 'Espèces']]],
    { fields: ['id', 'name'] }
  )
  return lines.map(l => l.id)
}

// ── Récupérer les numéros de facture (account.move.name) pour une liste d'IDs ──
async function getInvoiceNames(invoiceIds: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>()
  if (invoiceIds.length === 0) return map
  const moves = await odooRpc<any[]>(
    'account.move',
    'read',
    [invoiceIds],
    { fields: ['id', 'name'] }
  )
  for (const m of moves) map.set(m.id, m.name)
  return map
}

// ── Vérifie qu'un paiement Odoo est toujours "espèces / journal valide / paid" ──
async function isPaymentStillCash(paymentId: number, especesLineIds: number[]): Promise<boolean> {
  const rows = await odooRpc<any[]>(
    'account.payment',
    'read',
    [[paymentId]],
    { fields: ['id', 'state', 'journal_id', 'payment_method_line_id'] }
  )
  if (!rows || rows.length === 0) return false
  const p = rows[0]
  if (p.state !== 'paid') return false
  const journalId = Array.isArray(p.journal_id) ? p.journal_id[0] : p.journal_id
  if (!CASH_JOURNAL_IDS.includes(journalId)) return false
  const lineId = Array.isArray(p.payment_method_line_id) ? p.payment_method_line_id[0] : p.payment_method_line_id
  return especesLineIds.includes(lineId)
}

// ── Notif erreur (best effort) ─────────────────────────────
async function notifyError(message: string, context?: any) {
  console.error('[sync-cash-payments]', message, context ?? '')
  try {
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;max-width:600px;padding:20px">
        <h2 style="color:#cc2222">❌ Sync caisse Odoo en erreur</h2>
        <pre style="background:#f5f5f5;padding:12px;border-radius:6px;font-size:13px;white-space:pre-wrap;word-break:break-word">${message.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'} as Record<string, string>)[c] || c)}</pre>
        ${context ? `<pre style="background:#f5f5f5;padding:12px;border-radius:6px;font-size:11px;white-space:pre-wrap">${JSON.stringify(context, null, 2)}</pre>` : ''}
      </div>
    `
    await sendEmail(NOTIFY_EMAIL, '❌ Sync caisse Odoo échouée', html)
  } catch (e: any) {
    console.error('[sync-cash-payments] notif mail échec:', e.message)
  }
}

// ============================================================
// HANDLER
// ============================================================
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const result = { detected: 0, confirmed: 0, deleted: 0, errors: [] as string[] }

  try {
    // ── 0. Récupérer mappings users : odoo_user_id → Supabase id ──
    const { data: users } = await supabase
      .from('users')
      .select('id, odoo_user_id')
      .not('odoo_user_id', 'is', null)

    if (!users || users.length === 0) {
      return NextResponse.json({ ok: true, message: 'Aucun user mappé Odoo, rien à faire', ...result })
    }

    const odooUserIds = users.map(u => u.odoo_user_id as number)
    const odooToAppUser = new Map<number, string>(users.map(u => [u.odoo_user_id as number, u.id]))

    // ── 1. Récupérer les line IDs des "Espèces" sur DEP1+FOU1 ──
    const especesLineIds = await getEspecesLineIds()
    if (especesLineIds.length === 0) {
      await notifyError('Aucun account.payment.method.line "Espèces" trouvé sur les journaux DEP1+FOU1')
      return NextResponse.json({ ok: false, error: 'Espèces line IDs introuvables' }, { status: 500 })
    }

    // ============================================================
    // PHASE A — DÉTECTION : créer pending pour les nouveaux paiements
    // ============================================================
    // Borne basse : on prend le max(odoo_payment_id) déjà en cash_register pour ne pas re-traiter.
    // Si vide (premier run), on remonte 7 jours.
    const { data: lastSync } = await supabase
      .from('cash_register')
      .select('odoo_payment_id')
      .not('odoo_payment_id', 'is', null)
      .order('odoo_payment_id', { ascending: false })
      .limit(1)
      .maybeSingle()

    const minOdooId = lastSync?.odoo_payment_id ?? 0
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')

    const detectionDomain: any[] = [
      ['journal_id',             'in', CASH_JOURNAL_IDS],
      ['payment_method_line_id', 'in', especesLineIds],
      ['create_uid',             'in', odooUserIds],
      ['state',                  '=',  'paid'],
    ]
    if (minOdooId > 0) {
      detectionDomain.push(['id', '>', minOdooId])
    } else {
      detectionDomain.push(['create_date', '>=', sevenDaysAgo])
    }

    const newPayments = await odooRpc<any[]>(
      'account.payment',
      'search_read',
      [detectionDomain],
      {
        fields: ['id', 'amount', 'create_uid', 'create_date', 'invoice_ids', 'reconciled_invoice_ids', 'name'],
        order: 'id asc',
        limit: 200,
      }
    )

    if (newPayments.length > 0) {
      // Récupérer les noms des factures liées (account.move.name)
      const allInvoiceIds = Array.from(new Set(newPayments.flatMap(p =>
        [...(p.invoice_ids || []), ...(p.reconciled_invoice_ids || [])]
      )))
      const invoiceNames = await getInvoiceNames(allInvoiceIds)

      for (const p of newPayments) {
        const odooUid  = Array.isArray(p.create_uid) ? p.create_uid[0] : p.create_uid
        const driverId = odooToAppUser.get(odooUid)
        if (!driverId) continue  // user Odoo non mappé côté app

        // Numéro facture : priorité reconciled_invoice_ids[0], sinon invoice_ids[0]
        const invoiceId = (p.reconciled_invoice_ids?.[0]) || (p.invoice_ids?.[0])
        const invoiceName = (invoiceId && invoiceNames.get(invoiceId)) || 'Sans facture liée'

        const odooCreatedAt = (p.create_date as string).replace(' ', 'T') + 'Z'

        const { error } = await supabase.from('cash_register').insert({
          driver_id:        driverId,
          amount:           p.amount,
          type:             'encaissement',
          intervention_id:  null,
          notes:            invoiceName,
          odoo_payment_id:  p.id,
          odoo_status:      'pending',
          created_at:       odooCreatedAt,
        })

        if (error) {
          // Conflit de UNIQUE INDEX (déjà inséré sur un run précédent) = OK, on continue
          if (error.code === '23505') continue
          result.errors.push(`Insert payment ${p.id}: ${error.message}`)
        } else {
          result.detected++
        }
      }
    }

    // ============================================================
    // PHASE B — CONFIRMATION : pending de + 30 min → confirmed ou deleted
    // ============================================================
    const cutoff = new Date(Date.now() - PENDING_DELAY_MIN * 60 * 1000).toISOString()
    const { data: pendings } = await supabase
      .from('cash_register')
      .select('id, odoo_payment_id, created_at')
      .eq('odoo_status', 'pending')
      .lt('created_at', cutoff)

    for (const m of (pendings || [])) {
      try {
        const stillCash = await isPaymentStillCash(m.odoo_payment_id as number, especesLineIds)
        if (stillCash) {
          const { error } = await supabase
            .from('cash_register')
            .update({ odoo_status: 'confirmed' })
            .eq('id', m.id)
          if (error) result.errors.push(`Confirm ${m.id}: ${error.message}`)
          else result.confirmed++
        } else {
          // Le paiement n'est plus en espèces (ou annulé) → on retire le mouvement pending
          const { error } = await supabase.from('cash_register').delete().eq('id', m.id)
          if (error) result.errors.push(`Delete ${m.id}: ${error.message}`)
          else result.deleted++
        }
      } catch (e: any) {
        result.errors.push(`Re-vérif ${m.id}: ${e.message}`)
      }
    }

    // ============================================================
    // PHASE C — LOGGING + ALERTE SI ERREURS
    // ============================================================
    console.log(`[sync-cash-payments] détectés=${result.detected} confirmés=${result.confirmed} supprimés=${result.deleted} erreurs=${result.errors.length}`)
    if (result.errors.length > 0) {
      await notifyError(`Cron sync-cash-payments avec ${result.errors.length} erreur(s)`, result)
    }

    return NextResponse.json({ ok: true, ...result })

  } catch (e: any) {
    await notifyError(`Erreur fatale : ${e.message}`, { stack: e.stack })
    return NextResponse.json({ ok: false, error: e.message, ...result }, { status: 500 })
  }
}
