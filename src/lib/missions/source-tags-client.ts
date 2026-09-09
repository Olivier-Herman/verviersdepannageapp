'use client'
// Catalogue des sources côté navigateur : familles (tags) et libellés variants,
// lus une fois par page via /api/missions/sources. Lot B « sans valeurs en dur ».
import { useEffect, useState } from 'react'

export interface ClientSource { key: string; label: string; tags: string[]; label_tts: string | null; label_etiquette: string | null; label_encaissement: string | null; billing_group: string | null }
let promise: Promise<ClientSource[]> | null = null
export function fetchSourceCatalogClient(): Promise<ClientSource[]> {
  if (!promise) promise = fetch('/api/missions/sources').then(r => r.json()).then(j => (Array.isArray(j?.sources) ? j.sources : []).map((s: any) => ({ key: String(s.key), label: String(s.label || s.key), tags: Array.isArray(s.tags) ? s.tags : [], label_tts: s.label_tts ?? null, label_etiquette: s.label_etiquette ?? null, label_encaissement: s.label_encaissement ?? null, billing_group: s.billing_group ?? null }))).catch(() => { promise = null; return [] })
  return promise
}
/** null tant que le catalogue n'est pas chargé. */
export function useSourceCatalog(): ClientSource[] | null {
  const [cat, setCat] = useState<ClientSource[] | null>(null)
  useEffect(() => { let on = true; fetchSourceCatalogClient().then(c => { if (on) setCat(c) }); return () => { on = false } }, [])
  return cat
}
export function useSourcesWithTag(tag: string): string[] | null {
  const cat = useSourceCatalog()
  return cat ? cat.filter(s => s.tags.includes(tag)).map(s => s.key) : null
}
export function sourceHasTagClient(cat: ClientSource[] | null, source: string | null | undefined, tag: string): boolean {
  if (!cat || !source) return false
  const k = String(source).toLowerCase()
  return cat.some(s => s.key.toLowerCase() === k && s.tags.includes(tag))
}
export function useSourceLabel(source: string | null | undefined, variant: 'label' | 'tts' | 'etiquette' | 'encaissement' = 'label'): string | null {
  const cat = useSourceCatalog()
  if (!cat || !source) return null
  const row = cat.find(s => s.key.toLowerCase() === String(source).toLowerCase())
  if (!row) return null
  const v = variant === 'tts' ? row.label_tts : variant === 'etiquette' ? row.label_etiquette : variant === 'encaissement' ? row.label_encaissement : null
  return v || row.label
}
