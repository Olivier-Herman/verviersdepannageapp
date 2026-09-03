// src/lib/missions/saisie-odoo-invoice.ts
//
// Crée la FACTURE Odoo (brouillon) d'un état de frais saisie, à partir de ses
// lignes (saisie_etats_frais.lines_json). Réutilise createDraftInvoice
// (account.move out_invoice). L'employé la poste ensuite dans Odoo → Peppol.
//
// CONFORMITÉ SPF Justice (directive Peppol frais de justice, 22/12/2025) :
//   • le « N° de commande » (= account.move.ref → <cac:OrderReference><cbc:ID>
//     dans l'UBL, vérifié sur la facture 2026/05/385) DOIT porter ROJ-FJGK13
//     (bureau de taxation de Liège) ;
//   • le n° JustInvoice (JINV…) doit figurer sur la facture ;
//   • le n° de notice / dossier (PV) doit figurer sur la facture ;
//   • le détail du calcul n'est pas obligatoire mais le total doit être IDENTIQUE
//     à l'état de frais taxé → on reprend les lignes telles quelles.
// Partner Parquet = res.partner 65 (mention signature élec portée par le partner).
// Olivier 2026-08-10 / 2026-09-03. Cf [[project_facturation_saisie_module]].

import { createDraftInvoice, type QuoteLine, type ProductCode } from '@/lib/odoo-quote'
import { attachToOdoo } from '@/lib/odoo-attachment'

// res.partner par destinataire. Parquet = 65 (confirmé). Le Domaine a son propre
// circuit (module Domaine, facture trimestrielle partner 83) : jamais ici.
const PARTNER_BY_RECIPIENT: Record<string, number> = { parquet: 65 }

// Bureau de taxation compétent (Liège) — référence « N° de commande » Peppol.
export const TAXATION_OFFICE_REF = process.env.JUSTINGOV_TAXATION_REF || 'ROJ-FJGK13'

/** Référence Peppol « N° de commande » : ROJ-FJGK13 + JINV<n° JustInvoice>. */
export function peppolOrderRef(justinvoiceRef?: string | null): string {
  const ji = String(justinvoiceRef || '').trim()
  return ji ? `${TAXATION_OFFICE_REF} JINV${ji.replace(/^JINV/i, '')}` : TAXATION_OFFICE_REF
}

export interface SaisieInvoiceResult { ok: boolean; odooId?: number; url?: string; error?: string }

const fmtD = (ymd?: string | null) => (ymd ? String(ymd).slice(0, 10).split('-').reverse().join('/') : '')

async function dl(sb: any, path: string | null | undefined): Promise<Buffer | null> {
  if (!path) return null
  try {
    const { data } = await sb.storage.from('mission-remarks').download(path)
    return data ? Buffer.from(await data.arrayBuffer()) : null
  } catch { return null }
}

/**
 * Facture l'état de frais ciblé (efId) ou, à défaut, le plus ancien liquidé
 * (sinon déposé). Statuts acceptés : 'liquide' (process normal : après accord du
 * bureau de liquidation) et 'depose' (facturation anticipée, à la main).
 */
export async function createSaisieParquetInvoice(sb: any, dossierId: string, efId?: string | null): Promise<SaisieInvoiceResult> {
  const { data: d } = await sb.from('saisie_dossiers').select('*').eq('id', dossierId).maybeSingle()
  if (!d) return { ok: false, error: 'Dossier introuvable' }

  const partnerId = PARTNER_BY_RECIPIENT[d.recipient]
  if (!partnerId) return { ok: false, error: `Pas de facture Odoo ici pour « ${d.recipient} » (le Domaine se facture via le module Domaine, le client via la fiche).` }

  const sel = 'id, numero, lines_json, status, justinvoice_ref, validation_doc_path, period_from, period_to'
  let ef: any = null
  if (efId) {
    ef = (await sb.from('saisie_etats_frais').select(sel).eq('dossier_id', dossierId).eq('id', efId).maybeSingle()).data
  } else {
    ef = (await sb.from('saisie_etats_frais').select(sel).eq('dossier_id', dossierId).eq('status', 'liquide').order('created_at', { ascending: true }).limit(1).maybeSingle()).data
      || (await sb.from('saisie_etats_frais').select(sel).eq('dossier_id', dossierId).eq('status', 'depose').order('created_at', { ascending: true }).limit(1).maybeSingle()).data
  }
  if (!ef || !Array.isArray(ef.lines_json) || ef.lines_json.length === 0) {
    return { ok: false, error: 'Aucun état de frais déposé/liquidé à facturer' }
  }
  if (!['depose', 'liquide'].includes(ef.status)) return { ok: false, error: `Cet état de frais est « ${ef.status} », pas déposé ni liquidé.` }
  const jiRef = ef.justinvoice_ref || d.justinvoice_ref || null
  if (!jiRef) return { ok: false, error: 'N° JustInvoice manquant — la facture Peppol doit le porter (dépose d\'abord sur JustInvoice).' }

  const lines: QuoteLine[] = (ef.lines_json as any[]).map(l => ({
    kind:       l.kind as ProductCode,
    name:       l.period ? `${l.name} — ${fmtD(l.period.from)} au ${fmtD(l.period.to)}` : l.name,
    qty:        Number(l.qty) || 0,
    price_unit: Number(l.unitPrice) || 0,
  }))

  const veh = [d.vehicle_brand, d.vehicle_model].filter(Boolean).join(' ')
  const descParts = [
    `${TAXATION_OFFICE_REF} · JustInvoice JINV${String(jiRef).replace(/^JINV/i, '')}`,
    `État de frais ${ef.numero}`,
    d.dossier_ref ? `Notice / dossier : ${d.dossier_ref}` : '',
    `Véhicule ${d.vehicle_plate || ''} ${veh}`.trim(),
    ef.period_from && ef.period_to ? `Période du ${fmtD(ef.period_from)} au ${fmtD(ef.period_to)}` : '',
  ].filter(Boolean)

  try {
    const inv = await createDraftInvoice({
      partner_id: partnerId,
      origin: ef.numero,
      client_order_ref: peppolOrderRef(jiRef),   // → account.move.ref → OrderReference/ID Peppol
      sections: [{ lines }],
      description: descParts.join(' · '),
    })

    // Pièces au dossier de facture : état de frais signé (= approbation) + réquisitoire.
    // Non bloquant : la facture existe même si un document manque.
    let reqPath: string | null = null
    if (d.mission_id) {
      const { data: m } = await sb.from('incoming_missions').select('requisitoire_doc_path').eq('id', d.mission_id).maybeSingle()
      reqPath = m?.requisitoire_doc_path || null
    }
    const [signed, req] = await Promise.all([dl(sb, ef.validation_doc_path), dl(sb, reqPath)])
    const ext = (p?: string | null) => (String(p || '').split('.').pop() || 'pdf').toLowerCase()
    const mime = (e: string) => e === 'pdf' ? 'application/pdf' : e === 'png' ? 'image/png' : (e === 'jpg' || e === 'jpeg') ? 'image/jpeg' : 'application/octet-stream'
    if (signed) {
      await attachToOdoo({
        resModel: 'account.move', resId: inv.id,
        filename: `etat-de-frais-${ef.numero}-approuve.${ext(ef.validation_doc_path)}`,
        base64Data: signed.toString('base64'), mimetype: mime(ext(ef.validation_doc_path)),
        description: `État de frais ${ef.numero} approuvé par le Parquet (JustInvoice ${jiRef})`,
      }).catch((e: any) => console.warn('[saisie-invoice] PJ état de frais KO :', e?.message))
    }
    if (req) {
      await attachToOdoo({
        resModel: 'account.move', resId: inv.id,
        filename: `requisitoire-${d.vehicle_plate || 'saisie'}.${ext(reqPath)}`,
        base64Data: req.toString('base64'), mimetype: mime(ext(reqPath)),
        description: 'Réquisitoire',
      }).catch((e: any) => console.warn('[saisie-invoice] PJ réquisitoire KO :', e?.message))
    }

    const now = new Date().toISOString()
    await sb.from('saisie_etats_frais').update({ status: 'facture', odoo_invoice_id: inv.id }).eq('id', ef.id)
    await sb.from('saisie_dossiers').update({ odoo_invoice_id: inv.id, state: 'facture', updated_at: now }).eq('id', dossierId)
    return { ok: true, odooId: inv.id, url: inv.url }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Création facture Odoo échouée' }
  }
}
