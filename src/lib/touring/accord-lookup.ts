// src/lib/touring/accord-lookup.ts
//
// Construit la carte « n° de dossier Touring → n° d'accord » à partir du
// back-office COMEX BKO (onglet Invoices). Sert au rapprochement automatique :
// un dossier hors-comex déjà présent dans un accord = déjà facturé côté Touring.

import { getBkoAccounts, loginComexBko, listBkoAccords, listBkoDossiersForAccord } from './comex-bko'

export interface AccordMatch {
  numAccord: string
  account:   string
  prestation: string
}

function parseBkoDate(s: string): number {
  // "dd/mm/yyyy hh:mm:ss"
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s || '')
  if (!m) return 0
  return Date.UTC(+m[3], +m[2] - 1, +m[1])
}

/**
 * Retourne une Map dossier_number → AccordMatch pour les dossiers demandés.
 * @param targets  ensemble des n° de dossier qu'on cherche (borne le travail).
 * @param opts.maxAccords  nb max d'accords parcourus par compte (récent d'abord).
 * @param opts.sinceMs     n'examine que les accords créés après cette date.
 */
export async function buildDossierAccordMap(
  targets: Set<string>,
  opts: { maxAccords?: number; sinceMs?: number } = {},
): Promise<Map<string, AccordMatch>> {
  const out = new Map<string, AccordMatch>()
  if (!targets.size) return out
  const remaining = new Set(targets)
  const maxAccords = opts.maxAccords ?? 80
  const sinceMs = opts.sinceMs ?? 0

  for (const acct of getBkoAccounts()) {
    if (!remaining.size) break
    let cookie: string
    try { cookie = await loginComexBko(acct) } catch { continue }
    let accords
    try { accords = await listBkoAccords(cookie) } catch { continue }
    // Plus récent d'abord + fenêtre temporelle.
    accords = accords
      .filter(a => parseBkoDate(a.creationDate) >= sinceMs)
      .sort((a, b) => parseBkoDate(b.creationDate) - parseBkoDate(a.creationDate))
      .slice(0, maxAccords)

    for (const acc of accords) {
      if (!remaining.size) break
      let dossiers
      try { dossiers = await listBkoDossiersForAccord(cookie, acc.numAccord) } catch { continue }
      for (const d of dossiers) {
        // Un accord liste chaque cidDos ; on résout le n° de base ET la variante -REL.
        for (const key of [d.cidDos, `${d.cidDos}-REL`]) {
          if (remaining.has(key)) {
            out.set(key, { numAccord: acc.numAccord, account: acct.label, prestation: d.prestationType })
            remaining.delete(key)
          }
        }
      }
    }
  }
  return out
}
