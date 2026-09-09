'use client'
// Libellés des régimes de gardiennage avec les montants de la grille, côté navigateur.
import { useEffect, useState } from 'react'
import { gardiennageRegimeLabel, type GardiennageRegime } from './gardiennage-regime-label'

let promise: Promise<GardiennageRegime[]> | null = null
function load(): Promise<GardiennageRegime[]> {
  if (!promise) promise = fetch('/api/tarifs/gardiennage').then(r => r.json()).then(j => Array.isArray(j?.regimes) ? j.regimes : []).catch(() => { promise = null; return [] })
  return promise
}
export function useGardiennageRegimes(): GardiennageRegime[] | null {
  const [rows, setRows] = useState<GardiennageRegime[] | null>(null)
  useEffect(() => { let on = true; load().then(r => { if (on) setRows(r) }); return () => { on = false } }, [])
  return rows
}
/** { assistance: '🛟 Assistance — 3 premiers jours inclus', … } — sans montants tant que la grille n'est pas chargée. */
export function useGardiennageRegimeLabels(withEmoji = true): Record<string, string> {
  const rows = useGardiennageRegimes()
  const out: Record<string, string> = {}
  for (const k of ['assistance', 'saisie', 'siabis', 'autre']) out[k] = gardiennageRegimeLabel(k, rows?.find(r => r.regime === k) || null, withEmoji)
  return out
}
export { gardiennageRegimeLabel }
