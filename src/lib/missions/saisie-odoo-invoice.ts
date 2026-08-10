// src/lib/missions/saisie-odoo-invoice.ts
//
// Crée la FACTURE Odoo (brouillon) d'un dossier saisie, à partir des lignes du
// dernier état de frais (saisie_etats_frais.lines_json). Réutilise createDraftInvoice
// (account.move out_invoice). L'employé la poste ensuite dans Odoo.
// Partner : Parquet = res.partner 65 (mention signature élec BCF portée par le
// partner). Réf JustInvoice en client_order_ref. Olivier 2026-08-10.
// Cf [[project_facturation_saisie_module]] [[project_justinvoice_spf_justice]].

import { createDraftInvoice, type QuoteLine, type ProductCode } from '@/lib/odoo-quote'

// res.partner par destinataire. Parquet = 65 (confirmé). Domaine/Client à câbler.
const PARTNER_BY_RECIPIENT: Record<string, number> = { parquet: 65 }

export interface SaisieInvoiceResult { ok: boolean; odooId?: number; url?: string; error?: string }

const fmtD = (ymd?: string | null) => (ymd ? String(ymd).slice(0, 10).split('-').reverse().join('/') : '')

export async function createSaisieParquetInvoice(sb: any, dossierId: string): Promise<SaisieInvoiceResult> {
  const { data: d } = await sb.from('saisie_dossiers').select('*').eq('id', dossierId).maybeSingle()
  if (!d) return { ok: false, error: 'Dossier introuvable' }

  const partnerId = PARTNER_BY_RECIPIENT[d.recipient]
  if (!partnerId) return { ok: false, error: `Partner Odoo non configuré pour « ${d.recipient} » (seul le Parquet est câblé pour l'instant)` }

  // Dernier état de frais émis (celui déposé) → ses lignes.
  const { data: ef } = await sb.from('saisie_etats_frais')
    .select('numero, lines_json, period_from, period_to').eq('dossier_id', dossierId)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle()
  if (!ef || !Array.isArray(ef.lines_json) || ef.lines_json.length === 0) {
    return { ok: false, error: 'Aucune ligne d\'état de frais à facturer' }
  }

  const lines: QuoteLine[] = (ef.lines_json as any[]).map(l => ({
    kind:       l.kind as ProductCode,
    name:       l.period ? `${l.name} — ${fmtD(l.period.from)} au ${fmtD(l.period.to)}` : l.name,
    qty:        Number(l.qty) || 0,
    price_unit: Number(l.unitPrice) || 0,
  }))

  const veh = [d.vehicle_brand, d.vehicle_model].filter(Boolean).join(' ')
  const descParts = [
    `Véhicule ${d.vehicle_plate || ''} ${veh}`.trim(),
    d.dossier_ref ? `PV ${d.dossier_ref}` : '',
    d.justinvoice_ref ? `JustInvoice ${d.justinvoice_ref}` : '',
  ].filter(Boolean)

  try {
    const inv = await createDraftInvoice({
      partner_id: partnerId,
      origin: ef.numero,
      client_order_ref: d.justinvoice_ref || d.dossier_ref || ef.numero,
      sections: [{ lines }],
      description: descParts.join(' · '),
    })
    await sb.from('saisie_dossiers').update({
      odoo_invoice_id: inv.id, state: 'facture', updated_at: new Date().toISOString(),
    }).eq('id', dossierId)
    return { ok: true, odooId: inv.id, url: inv.url }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Création facture Odoo échouée' }
  }
}
