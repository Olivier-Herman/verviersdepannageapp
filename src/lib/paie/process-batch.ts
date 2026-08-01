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

interface PayslipRange { worker_name: string; start_page: number; end_page: number }

/** Claude lit le PDF et renvoie une plage de pages par travailleur. */
async function detectRanges(pdfB64: string): Promise<PayslipRange[]> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const prompt = `Ce PDF contient PLUSIEURS fiches de paie, une par travailleur (souvent 1 page chacune, parfois 2).
Pour CHAQUE travailleur, donne son NOM COMPLET et sa plage de pages.
Réponds UNIQUEMENT en JSON valide :
{ "payslips": [ { "worker_name": "<Prénom NOM tel qu'écrit>", "start_page": <n>, "end_page": <n> } ] }
Règles : pages 1-indexées ; plages CONTIGUËS couvrant tout le PDF sans trou ni chevauchement ; une entrée par travailleur ; garde le nom exactement tel qu'imprimé.`
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

export interface SplitPayslip { worker_name: string; pages: number; pdf_b64: string }

/** Découpe le PDF en une fiche par travailleur (base64). */
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
    out.push({ worker_name: r.worker_name || '?', pages: end - start + 1, pdf_b64: Buffer.from(bytes).toString('base64') })
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

export interface IngestResult { total: number; stored: number; skipped: number }

/**
 * Traite un PDF de fiches de paie : découpe, rattache, stocke (idempotent par
 * personne + période + société).
 */
export async function ingestPayslipPdf(sb: any, opts: {
  pdfBytes: Uint8Array; period: string; companyCode: string; source: string; sourceRef?: string
}): Promise<IngestResult> {
  const slips = await splitPayslips(opts.pdfBytes)
  let stored = 0, skipped = 0
  for (const s of slips) {
    const personnelId = await findOrCreatePersonnel(sb, s.worker_name, opts.companyCode)
    if (personnelId) {
      // Existe déjà pour cette personne + période + société ? → on saute.
      const { data: dup } = await sb.from('payslips').select('id')
        .eq('personnel_id', personnelId).eq('period', opts.period).eq('company_code', opts.companyCode).limit(1)
      if (dup?.[0]) { skipped++; continue }
    }
    const { error } = await sb.from('payslips').insert({
      personnel_id: personnelId, worker_name: s.worker_name, period: opts.period,
      company_code: opts.companyCode, pages: s.pages, pdf_b64: s.pdf_b64,
      source: opts.source, source_ref: opts.sourceRef || null,
    })
    if (error) skipped++; else stored++
  }
  return { total: slips.length, stored, skipped }
}
