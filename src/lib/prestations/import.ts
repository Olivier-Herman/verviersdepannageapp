// src/lib/prestations/import.ts
//
// Importe les feuilles de présence EasyPay dans prestation_sheets. Réutilise la
// récup du ZIP mensuel (fetchPayslipMails). La feuille est celle du MOIS SUIVANT
// (période lue dans la feuille). Au ré-import, on NE réécrase PAS les jours déjà
// édités par Momo (on ne met à jour que les métadonnées).

import { createAdminClient } from '@/lib/supabase'
import { fetchPayslipMails } from '@/lib/paie/fetch-mail'
import { extractPrestationsPdf, parsePrestationSheet } from './parse-sheet'
import { nameKey } from '@/lib/paie/process-batch'

/** Par défaut on ne traite que le mail le plus récent (mois précédent) : la feuille
 *  du mois à venir est toujours dans le dernier ZIP. Évite de rappeler Claude sur
 *  tout l'historique (lent). Passer `from` (AAAA-MM) pour remonter plus loin. */
function defaultFrom(): string {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export async function importPrestations(from?: string) {
  const sb = createAdminClient()
  const mails = await fetchPayslipMails(from || defaultFrom())
  const { data: pers } = await sb.from('personnel').select('id, name_key, matricule, company_code')

  const results: any[] = []
  for (const m of mails) {
    const pdf = await extractPrestationsPdf(m.zipBuffer)
    if (!pdf) { results.push({ mail: `${m.companyCode} ${m.period}`, note: 'pas de feuille de prestations' }); continue }

    let sheet
    try { sheet = await parsePrestationSheet(pdf) } catch (e: any) { results.push({ mail: m.period, error: e.message }); continue }
    const period = sheet.period || m.period
    const cc = sheet.company_code || m.companyCode

    let stored = 0, updated = 0
    for (const w of (sheet.workers || [])) {
      const mat = String(w.matricule || '')
      const byMat  = mat ? (pers || []).find((p: any) => p.matricule && String(p.matricule) === mat && (!p.company_code || p.company_code === cc)) : null
      const byName = (pers || []).find((p: any) => p.name_key === nameKey(w.name))
      const match  = byMat || byName
      // Auto-remplit le matricule VD Soft s'il manque
      if (match && !match.matricule && mat) { try { await sb.from('personnel').update({ matricule: mat }).eq('id', match.id) } catch {} }

      const meta = {
        personnel_id: match?.id || null, worker_name: w.name, departement: w.departement,
        statut: w.statut, qs: w.qs, fonction: w.fonction,
        conges_jours: w.conges_jours, conges_heures: w.conges_heures,
        source_ref: m.messageId, updated_at: new Date().toISOString(),
      }

      const { data: ex } = await sb.from('prestation_sheets').select('id')
        .eq('period', period).eq('company_code', cc).eq('matricule', mat).maybeSingle()

      if (ex) {
        // Existe déjà → on met à jour les métadonnées mais on PRÉSERVE `days` (éditions Momo).
        await sb.from('prestation_sheets').update(meta).eq('id', ex.id)
        updated++
      } else {
        const days: Record<string, any> = {}
        for (const [d, h] of Object.entries(w.days || {})) days[d] = { h: Number(h) || 0 }
        const { error } = await sb.from('prestation_sheets').insert({ period, company_code: cc, matricule: mat, days, ...meta })
        if (!error) stored++
      }
    }
    results.push({ period, company: cc, workers: (sheet.workers || []).length, stored, updated })
  }
  return results
}
