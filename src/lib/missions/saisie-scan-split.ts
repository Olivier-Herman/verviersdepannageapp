// src/lib/missions/saisie-scan-split.ts
//
// SCAN GROUPÉ des états de frais renvoyés signés par le Parquet : on uploade le
// PDF complet (une page = un état de frais signé), on le DÉCOUPE page par page,
// Claude lit le n° EDF (grand, en haut à droite) + détecte un éventuel REFUS, on
// rattache chaque page à son dossier (pièce jointe) et on le passe en accepté/refusé.
// Olivier 2026-08-10. Palier suivant : pousser vers JustInvoice.

import { PDFDocument } from 'pdf-lib'
import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL } from '@/lib/anthropic-model'

const BUCKET = 'mission-remarks'

const PROMPT = `Ce document est un « État de frais » de fourrière (société Verviers Dépannage) qui a été renvoyé SIGNÉ par le Parquet / les frais de justice.
1) Lis son NUMÉRO, au format EDF-AAAA-NNNN (généralement en haut à droite, en gros). Recopie-le exactement.
2) Indique s'il porte une mention de REFUS / désaccord / non-accord (sinon considère que c'est un accord).
Réponds STRICTEMENT en JSON, sans texte autour :
{"numero": "EDF-2026-0001" ou null si illisible, "refus": true ou false}`

interface PageRead { numero: string | null; refus: boolean }

async function readEdf(client: Anthropic, pdfBase64: string): Promise<PageRead> {
  try {
    const resp = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } } as any,
          { type: 'text', text: PROMPT },
        ],
      }],
    })
    const txt = (resp.content as any[]).filter(b => b.type === 'text').map(b => b.text).join('').trim()
    const m = txt.match(/\{[\s\S]*\}/)
    if (!m) return { numero: null, refus: false }
    const j = JSON.parse(m[0])
    const numero = j.numero ? String(j.numero).toUpperCase().replace(/\s+/g, '').match(/EDF-\d{4}-\d{3,}/)?.[0] || null : null
    return { numero, refus: j.refus === true }
  } catch { return { numero: null, refus: false } }
}

export interface ScanSplitPageResult {
  page: number
  numero: string | null
  refus: boolean
  matched: boolean
  dossierId?: string
  plate?: string | null
  note: string
}
export interface ScanSplitSummary {
  pages: number
  attached: number
  refused: number
  unmatched: number
  results: ScanSplitPageResult[]
}

export async function splitAndDispatch(sb: any, pdfBuffer: Buffer, userId?: string | null): Promise<ScanSplitSummary> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquant')
  const client = new Anthropic({ apiKey })

  const src = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true })
  const n = src.getPageCount()
  const out: ScanSplitSummary = { pages: n, attached: 0, refused: 0, unmatched: 0, results: [] }

  for (let i = 0; i < n; i++) {
    // Découpe la page i en un PDF autonome.
    const one = await PDFDocument.create()
    const [pg] = await one.copyPages(src, [i])
    one.addPage(pg)
    const bytes = await one.save()
    const buf = Buffer.from(bytes)
    const b64 = buf.toString('base64')

    const { numero, refus } = await readEdf(client, b64)
    const res: ScanSplitPageResult = { page: i + 1, numero, refus, matched: false, note: '' }

    if (!numero) { res.note = 'N° EDF illisible'; out.unmatched++; out.results.push(res); continue }

    // On rattache à l'ÉTAT DE FRAIS précis (par son n° EDF), pas « le dernier ».
    const { data: ef } = await sb.from('saisie_etats_frais')
      .select('id, dossier_id, numero').eq('numero', numero).maybeSingle()
    if (!ef) { res.note = `Aucun état de frais ${numero}`; out.unmatched++; out.results.push(res); continue }
    const { data: dossier } = await sb.from('saisie_dossiers')
      .select('id, mission_id, vehicle_plate').eq('id', ef.dossier_id).maybeSingle()

    res.dossierId = ef.dossier_id
    res.plate = dossier?.vehicle_plate

    // Stocke la page signée.
    const path = `saisie-validation/${ef.dossier_id}/${Date.now()}_signe_${numero}.pdf`
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, buf, { contentType: 'application/pdf', upsert: false })
    if (upErr) { res.note = `Upload échoué : ${upErr.message}`; out.unmatched++; out.results.push(res); continue }

    const now = new Date().toISOString()
    // Marque CET état de frais accepté/refusé (son propre cycle).
    await sb.from('saisie_etats_frais').update({
      status: refus ? 'refuse' : 'accepte', validation_doc_path: path, validation_at: now,
    }).eq('id', ef.id)
    // Rollup dossier (affichage cockpit).
    await sb.from('saisie_dossiers').update({
      validation_doc_path: path, validation_at: now, state: refus ? 'refuse' : 'accepte',
      notes: `${refus ? 'Refusé' : 'Accepté'} par le Parquet (scan groupé — ${numero}).`, updated_at: now,
    }).eq('id', ef.dossier_id)

    if (dossier?.mission_id) {
      await sb.from('mission_remarks')
        .insert({ mission_id: dossier.mission_id, text: `${refus ? '❌ Refus' : '✅ Accord'} Parquet — état de frais ${numero} (scan groupé)`, created_by: userId || null })
        .then(() => {}, () => {})
    }

    res.matched = true
    res.note = refus ? `Refusé (${numero})` : `Accepté (${numero})`
    if (refus) out.refused++; else out.attached++
    out.results.push(res)
  }

  return out
}
