// ============================================================
// VERVIERS DÉPANNAGE — Module Paie : traitement d'un batch de fiches
// ------------------------------------------------------------
// ZIP EasyPay → PDF *FICHES_DE_PAIE* → découpage par travailleur (Claude
// identifie nom + pages) → rattachement au répertoire Personnel → stockage.
// ============================================================

import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL } from '@/lib/anthropic-model'

const stripAccents = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
/** Clé de matching nom : minuscules, sans accent, MOTS TRIÉS (ordre indifférent). */
export const nameKey = (s: string) =>
  stripAccents(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ')

/** Extrait le PDF des fiches de paie d'un ZIP EasyPay. */
export async function extractPayslipPdf(zipBuffer: Buffer): Promise<Uint8Array | null> {
  const zip = await JSZip.loadAsync(zipBuffer)
  const entry = Object.values(zip.files).find(f => /FICHES_DE_PAIE/i.test(f.name) && /\.pdf$/i.test(f.name))
  if (!entry) return null
  return await entry.async('uint8array')
}

interface PayslipRange {
  worker_name: string; type: string; label: string; start_page: number; end_page: number
  vac_total: number | null; vac_used: number | null; vac_available: number | null
  montant_net: number | null; montant_brut: number | null; cout_employeur: number | null
  infos: any
}

/** Claude lit le PDF et renvoie une plage de pages par FICHE (un travailleur
 *  peut avoir plusieurs fiches le même mois). */
async function detectRanges(pdfB64: string): Promise<PayslipRange[]> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const prompt = `Ce PDF contient PLUSIEURS fiches de paie. ATTENTION : un même travailleur peut avoir PLUSIEURS fiches le même mois (ex : Salaire ordinaire, Prime, Pécule/double pécule de vacances, Congé). Chaque fiche est une entrée distincte.
Pour CHAQUE fiche, donne le NOM COMPLET du travailleur, le TYPE et sa plage de pages.
Réponds UNIQUEMENT en JSON valide :
{ "payslips": [ {
  "worker_name": "<Prénom NOM tel qu'écrit>",
  "type": "<salaire|prime|vacances|conge|autre>",
  "label": "<libellé exact de la fiche, ex 'Pécule de vacances'>",
  "start_page": <n>, "end_page": <n>,
  "vac_total": <heures de vacances : DROIT total, ou null>,
  "vac_used": <heures PRISES / utilisées, ou null>,
  "vac_available": <heures DISPONIBLES / solde restant, ou null>,
  "montant_net": <NET À PAYER en €, ou null>,
  "montant_brut": <BRUT en €, ou null>,
  "cout_employeur": <COÛT TOTAL EMPLOYEUR en € si indiqué (brut + charges patronales), sinon null>,
  "infos": {
    "matricule": "<numéro/matricule du travailleur (No.) tel qu'imprimé, ou null>",
    "date_naissance": "<date de naissance au format AAAA-MM-JJ, ou null>",
    "adresse": "<rue + numéro du travailleur tel qu'imprimé, ou null>",
    "code_postal": "<code postal, ou null>",
    "ville": "<ville, ou null>",
    "national_number": "<n° national / NISS tel qu'imprimé, ou null>",
    "iban": "<IBAN du compte de versement, ou null>",
    "etat_civil": "<état civil / situation familiale si indiqué (célibataire, marié…), ou null>",
    "personnes_charge": <nombre de personnes/enfants à charge si indiqué, sinon null>
  }
} ] }
Règles : pages 1-indexées ; les plages couvrent TOUT le PDF sans chevauchement ; une entrée PAR FICHE (pas par travailleur) ; nom exactement tel qu'imprimé ; type parmi la liste (salaire par défaut).
Congés : cherche les compteurs de vacances (souvent « Vac. légales », « Congés », en heures) — total / pris / solde. En HEURES (nombre). Si absent, null.
Montants : montant_net = le NET À PAYER de CETTE fiche (€) ; montant_brut = le brut ; cout_employeur = coût total employeur si la fiche l'indique, sinon null. Nombres, pas de symbole. Si absent, null.
Infos : recopie les DONNÉES PERSONNELLES du travailleur telles qu'imprimées sur la fiche (adresse, NISS, IBAN, état civil, personnes à charge), pour recoupement. Toute info absente de la fiche → null.`
  const res = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 } },
      { type: 'text', text: prompt },
    ] }],
  })
  const block = res.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('Aucun texte de Claude')
  const cleaned = block.text.trim().replace(/^```json\s*/, '').replace(/```\s*$/, '').trim()
  const parsed = JSON.parse(cleaned)
  return Array.isArray(parsed.payslips) ? parsed.payslips : []
}

export interface SplitPayslip {
  worker_name: string; type: string; label: string; pages: number; pdf_b64: string
  vac_total: number | null; vac_used: number | null; vac_available: number | null
  montant_net: number | null; montant_brut: number | null; cout_employeur: number | null
  slip_infos: any
}
const num = (v: any): number | null => (typeof v === 'number' && isFinite(v)) ? v : null

const TYPES = ['salaire', 'prime', 'vacances', 'conge', 'autre']

/** Découpe le PDF en une fiche par entrée (base64). */
export async function splitPayslips(pdfBytes: Uint8Array): Promise<SplitPayslip[]> {
  const pdfB64 = Buffer.from(pdfBytes).toString('base64')
  const ranges = await detectRanges(pdfB64)
  const src = await PDFDocument.load(pdfBytes, { ignoreEncryption: true })
  const total = src.getPageCount()
  const out: SplitPayslip[] = []
  for (const r of ranges) {
    const start = Math.max(1, r.start_page || 1), end = Math.min(total, r.end_page || start)
    if (end < start) continue
    const doc = await PDFDocument.create()
    const idx = Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i)
    const pages = await doc.copyPages(src, idx)
    pages.forEach(p => doc.addPage(p))
    const bytes = await doc.save()
    out.push({
      worker_name: r.worker_name || '?',
      type: TYPES.includes(r.type) ? r.type : 'salaire',
      label: r.label || null as any,
      pages: end - start + 1,
      pdf_b64: Buffer.from(bytes).toString('base64'),
      vac_total: num(r.vac_total), vac_used: num(r.vac_used), vac_available: num(r.vac_available),
      montant_net: num(r.montant_net), montant_brut: num(r.montant_brut), cout_employeur: num(r.cout_employeur),
      slip_infos: r.infos && typeof r.infos === 'object' ? r.infos : null,
    })
  }
  return out
}

/** Rattache un nom à une personne du répertoire, en crée une si absente. */
async function findOrCreatePersonnel(sb: any, name: string, companyCode: string | null): Promise<string | null> {
  const key = nameKey(name)
  if (!key) return null
  const { data: found } = await sb.from('personnel').select('id').eq('name_key', key).limit(1)
  if (found?.[0]) return found[0].id
  const { data: created } = await sb.from('personnel')
    .insert({ name: name.trim(), name_key: key, company_code: companyCode }).select('id').single()
  return created?.id || null
}

/** Complète les champs VIDES de la fiche employé depuis les infos lues sur la
 *  fiche de paie (n'écrase jamais une valeur déjà saisie). */
async function autoFillPersonnel(sb: any, personnelId: string, infos: any): Promise<void> {
  if (!personnelId || !infos || typeof infos !== 'object') return
  const { data: p } = await sb.from('personnel')
    .select('matricule, birth_date, adresse, code_postal, ville, national_number, iban, etat_civil, personnes_charge')
    .eq('id', personnelId).maybeSingle()
  if (!p) return
  const patch: Record<string, any> = {}
  const empty = (v: any) => v == null || v === ''
  const setIf = (field: string, val: any) => { if (empty(p[field]) && !empty(val)) patch[field] = val }
  setIf('matricule', infos.matricule != null ? String(infos.matricule) : null)
  if (empty(p.birth_date) && /^\d{4}-\d{2}-\d{2}$/.test(String(infos.date_naissance || ''))) patch.birth_date = infos.date_naissance
  setIf('adresse', infos.adresse)
  setIf('code_postal', infos.code_postal)
  setIf('ville', infos.ville)
  setIf('national_number', infos.national_number)
  setIf('iban', infos.iban ? String(infos.iban).replace(/\s+/g, '').toUpperCase() : null)
  setIf('etat_civil', infos.etat_civil)
  if (empty(p.personnes_charge) && infos.personnes_charge != null && infos.personnes_charge !== '') patch.personnes_charge = Number(infos.personnes_charge)
  if (Object.keys(patch).length) { try { await sb.from('personnel').update(patch).eq('id', personnelId) } catch {} }
}

export interface IngestResult { total: number; stored: number; updated: number; skipped: number }

/** Champs enrichis (re)lus par Claude — mis à jour sur une fiche existante sans
 *  écraser une valeur déjà présente par un null (Claude peut ne pas relire un champ). */
function enrichPatch(s: SplitPayslip): Record<string, any> {
  const patch: Record<string, any> = {}
  const set = (k: string, v: any) => { if (v !== null && v !== undefined) patch[k] = v }
  set('vac_total', s.vac_total); set('vac_used', s.vac_used); set('vac_available', s.vac_available)
  set('montant_net', s.montant_net); set('montant_brut', s.montant_brut); set('cout_employeur', s.cout_employeur)
  set('slip_infos', s.slip_infos); set('label', s.label)
  return patch
}

/**
 * Traite un PDF de fiches de paie : découpe, rattache, stocke. Idempotent par
 * personne + type + période + société : une fiche déjà présente est MISE À JOUR
 * (montants, congés, infos) — ce qui permet à « Re-traiter » de compléter l'existant.
 */
export async function ingestPayslipPdf(sb: any, opts: {
  pdfBytes: Uint8Array; period: string; companyCode: string; source: string; sourceRef?: string
}): Promise<IngestResult> {
  const slips = await splitPayslips(opts.pdfBytes)
  const keyOf = (personnelId: string | null, worker: string, type: string) => `${personnelId || nameKey(worker)}|${type || 'salaire'}`

  const { data: existing } = await sb.from('payslips')
    .select('id, personnel_id, worker_name, type').eq('period', opts.period).eq('company_code', opts.companyCode)
  const idByKey = new Map<string, string>()
  for (const e of (existing || [])) idByKey.set(keyOf(e.personnel_id, e.worker_name, e.type), e.id)

  let stored = 0, updated = 0, skipped = 0
  for (const s of slips) {
    const personnelId = await findOrCreatePersonnel(sb, s.worker_name, opts.companyCode)
    if (personnelId) await autoFillPersonnel(sb, personnelId, s.slip_infos)   // remplit les champs vides de la fiche
    const k = keyOf(personnelId, s.worker_name, s.type)
    const existingId = idByKey.get(k)
    if (existingId) {
      // Fiche déjà là → complète les infos enrichies (ne ré-insère pas).
      const patch = enrichPatch(s)
      if (Object.keys(patch).length) { const { error } = await sb.from('payslips').update(patch).eq('id', existingId); error ? skipped++ : updated++ }
      else skipped++
      continue
    }
    const { error } = await sb.from('payslips').insert({
      personnel_id: personnelId, worker_name: s.worker_name, period: opts.period,
      company_code: opts.companyCode, type: s.type, label: s.label, pages: s.pages, pdf_b64: s.pdf_b64,
      vac_total: s.vac_total, vac_used: s.vac_used, vac_available: s.vac_available,
      montant_net: s.montant_net, montant_brut: s.montant_brut, cout_employeur: s.cout_employeur,
      slip_infos: s.slip_infos,
      source: opts.source, source_ref: opts.sourceRef || null,
    })
    if (error) skipped++; else { stored++; idByKey.set(k, 'new') }
  }
  return { total: slips.length, stored, updated, skipped }
}
