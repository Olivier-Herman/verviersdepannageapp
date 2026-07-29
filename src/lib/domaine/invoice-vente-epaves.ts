// src/lib/domaine/invoice-vente-epaves.ts
//
// Facture trimestrielle du gardiennage Domaine (État), après validation par
// Rosemarie. Crée UNE facture Odoo à « Service Public Fédéral Finances » avec
// une seule ligne (forfait = total HTVA du trimestre), y attache le tableau
// Excel, et la comptabilise. PAS d'envoi (l'équipe envoie depuis Odoo).
// Calqué sur la facture de référence 2026/01/248. Olivier 2026-07-29.

import { withOdooActor, odooRpc } from '@/lib/odoo'
import { attachToOdoo } from '@/lib/odoo-attachment'
import { computeDomaineBilling } from '@/lib/fourriere/domaine-billing'
import { buildDomaineXlsxBuffer } from '@/lib/fourriere/domaine-xlsx'

// Paramètres Odoo (facture de référence 2026/01/248).
const DOMAINE_PARTNER_ID = 83   // Service Public Fédéral Finances
const DOMAINE_JOURNAL_ID = 7    // Sales
const DOMAINE_PRODUCT_ID = 5    // [FORFAIT] Forfait
const DOMAINE_TAX_ID     = 5    // TVA 21%

export interface DomaineInvoiceResult {
  ok: boolean
  invoiceId?: number
  invoiceNumber?: string | null
  total?: number
  count?: number
  posted?: boolean
  error?: string
}

const dateOnly = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' })

function quarterLabel(from: string): string {
  const d = new Date(`${from}T00:00:00Z`)
  const q = Math.floor(d.getUTCMonth() / 3) + 1
  const ord = ['1er', '2ème', '3ème', '4ème'][q - 1] || `${q}ème`
  return `${ord} trimestre ${d.getUTCFullYear()}`
}

export async function createDomaineQuarterInvoice(input: {
  from: string; to: string; ref?: string | null; actorUserId?: string | null;
}): Promise<DomaineInvoiceResult> {
  const { from, to, ref, actorUserId } = input
  return withOdooActor(actorUserId, async () => {
    try {
      const { createAdminClient } = await import('@/lib/supabase')
      const sb = createAdminClient()
      const { groups, total, totalDays, count } = await computeDomaineBilling(sb, from, to)
      if (!count) return { ok: false, error: 'Aucune vente Domaine sur cette période' }
      if (!(total > 0)) return { ok: false, error: 'Total à 0 € — Date OUT (enlèvement) manquante sur les fiches ?' }

      const label = quarterLabel(from)

      // 1) Facture brouillon, une seule ligne forfait = total HTVA.
      const moveId = await odooRpc<number>('account.move', 'create', [{
        move_type:    'out_invoice',
        partner_id:   DOMAINE_PARTNER_ID,
        journal_id:   DOMAINE_JOURNAL_ID,
        invoice_date: dateOnly(),
        ...(ref ? { ref: String(ref) } : {}),
        invoice_line_ids: [[0, 0, {
          product_id: DOMAINE_PRODUCT_ID,
          name:       `[FORFAIT] Forfait\n${label} suivant tableau en annexe`,
          quantity:   1,
          price_unit: Math.round(total * 100) / 100,
          tax_ids:    [[6, 0, [DOMAINE_TAX_ID]]],
        }]],
      }])

      // 2) Comptabilise (post). PAS d'envoi.
      const before = (await odooRpc<any[]>('account.move', 'read', [[moveId]], { fields: ['state'] }))?.[0]
      if (before?.state === 'draft') await odooRpc('account.move', 'action_post', [[moveId]])

      // 3) Attache le tableau Excel du trimestre.
      const buffer = buildDomaineXlsxBuffer(groups, total, totalDays)
      await attachToOdoo({
        resModel: 'account.move', resId: moveId,
        filename: `gardiennage_domaine_${from}_${to}.xlsx`,
        base64Data: buffer.toString('base64'),
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        description: `Détail gardiennage Domaine — ${label} (${count} véhicule(s), ${totalDays} jours)`,
      }).catch((e: any) => console.warn('[domaine-invoice] attachement KO (non bloquant):', e?.message))

      const after = (await odooRpc<any[]>('account.move', 'read', [[moveId]], { fields: ['name', 'state'] }))?.[0]
      return {
        ok: true, invoiceId: moveId, invoiceNumber: after?.name || null,
        total: Math.round(total * 100) / 100, count, posted: after?.state === 'posted',
      }
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e).slice(0, 250) }
    }
  })
}
