// src/lib/mecano/ingest.ts
//
// Ingestion de la base technique Touring dans VD Soft (« La tête à Matthieu »).
// Pour une marque : liste les fiches (dépannage + remorquage), télécharge les
// PDF, les mirroir dans Supabase Storage (bucket 'mecano'), et upsert les
// métadonnées dans mecano_docs. Idempotent (unique section+source_url).
// Le texte est extrait à la volée au moment du chat (POC) — pas ici.

import { createAdminClient } from '@/lib/supabase'
import { prestexLogin, prestexListBrand, prestexDownloadPdf, type PrestexSection } from './prestex'

/** Normalise marque/modèle pour le matching (ASCII majuscule sans accents/séparateurs). */
export function normVehicle(s: string): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]/g, '')
}

const storagePathFor = (section: string, brand: string, model: string, label: string) =>
  `${section}/${normVehicle(brand)}/${normVehicle(model)}/${normVehicle(label)}.pdf`.replace(/\/+/g, '/')

export interface IngestResult { brand: string; listed: number; mirrored: number; upserted: number; skipped: number; errors: string[] }

/**
 * Ingest une marque. `limit` borne le nombre de PDF téléchargés par appel
 * (pour rester sous maxDuration) → rappeler jusqu'à mirrored < limit.
 */
export async function ingestBrand(brand: string, opts: { sections?: PrestexSection[]; limit?: number } = {}): Promise<IngestResult> {
  const sb = createAdminClient()
  const session = await prestexLogin()
  const sections = opts.sections || ['patrouilleur', 'remorquage']
  const limit = opts.limit ?? 40
  const res: IngestResult = { brand, listed: 0, mirrored: 0, upserted: 0, skipped: 0, errors: [] }

  // Déjà en base pour cette marque → on évite de re-télécharger.
  const { data: existing } = await sb.from('mecano_docs').select('source_url, storage_path').eq('brand', brand)
  const done = new Set((existing || []).filter(d => d.storage_path).map(d => d.source_url))

  for (const section of sections) {
    let docs: Awaited<ReturnType<typeof prestexListBrand>> = []
    try { docs = await prestexListBrand(session, section, brand) }
    catch (e: any) { res.errors.push(`list ${section}: ${e?.message}`); continue }
    res.listed += docs.length

    for (const d of docs) {
      if (res.mirrored >= limit) break
      const row = {
        section: d.section, brand: d.brand, model: d.model, doc_num: d.doc_num,
        doc_type: d.doc_type, label: d.label, source_url: d.url,
        brand_norm: normVehicle(d.brand), model_norm: normVehicle(d.model),
        updated_at: new Date().toISOString(),
      }
      if (done.has(d.url)) {
        // métadonnées à jour, PDF déjà mirroir → upsert léger
        await sb.from('mecano_docs').upsert(row, { onConflict: 'section,source_url' })
        res.skipped++
        continue
      }
      try {
        const pdf = await prestexDownloadPdf(session, d.url)
        const path = storagePathFor(d.section, d.brand, d.model, `${d.doc_num}_${d.label}`)
        const up = await sb.storage.from('mecano').upload(path, pdf, { contentType: 'application/pdf', upsert: true })
        if (up.error) throw new Error(up.error.message)
        await sb.from('mecano_docs').upsert({ ...row, storage_path: path }, { onConflict: 'section,source_url' })
        res.mirrored++; res.upserted++
      } catch (e: any) {
        res.errors.push(`${d.model}/${d.label}: ${e?.message}`.slice(0, 160))
      }
    }
  }
  return res
}
