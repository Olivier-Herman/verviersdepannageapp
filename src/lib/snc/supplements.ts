// Suppléments techniques et frais complémentaires Siabis+ (grille officielle SPW / SOFICO / Police fédérale,
// Olivier 19/10/2026, mission 10195398 : « supplément grue »). Cochés sur la fiche (dispatch) pour qu'ils
// soient repris tout seuls dans l'estimation, la facturation et l'écran client — 3 jours après, on ne s'en
// souvient plus. Fichier sans import serveur : lu par la fiche dispatch (client) et par le moteur Siabis.
// Prix HTVA : réglages métier `siabis_sup_<clé>` (et `_maj` pour le tarif majoré), jamais dans le code.

export interface SncSupplementDef {
  key:       string
  label:     string
  /** « pas cumulatifs entre eux » (astérisque de la grille) : un seul par intervention. */
  exclusif?: boolean
  /** Quantité saisie (sacs, tranches de 15 min) ; sinon simple case à cocher. */
  unite?:    string
  /** Prix différent en heures majorées. */
  majore?:   boolean
  aide?:     string
}

export const SNC_SUPPLEMENTS: SncSupplementDef[] = [
  { key: 'grue',      label: 'Usage de la grue',               exclusif: true },
  { key: 'anneau',    label: 'Absence d’anneau de remorquage', exclusif: true },
  { key: 'roue',      label: 'Roue de secours',                exclusif: true },
  { key: 'cles',      label: 'Absence de clés',                exclusif: true },
  { key: 'batterie',  label: 'Déconnexion de la batterie' },
  { key: 'absorbant', label: 'Absorbant',                      unite: 'sac', aide: 'par sac utilisé' },
  { key: 'adapte',    label: 'Usage d’un véhicule adapté',     majore: true },
  { key: 'horaire',   label: 'Supplément horaire',             unite: 'tranche de 15 min', majore: true, aide: 'par tranche de 15 minutes entamée' },
  { key: 'taxi',      label: 'Frais d’évacuation par taxi' },
]

/** Sur la fiche : { grue: 1, absorbant: 2, horaire: 3 } (0 / absent = non). */
export type SncSupplements = Record<string, number>

export function normSupplements(v: any): SncSupplements {
  let o: any = v
  if (typeof o === 'string') { try { o = JSON.parse(o) } catch { o = null } }
  const out: SncSupplements = {}
  if (!o || typeof o !== 'object') return out
  for (const s of SNC_SUPPLEMENTS) {
    const n = o[s.key] === true ? 1 : Math.floor(Number(o[s.key]) || 0)
    if (n > 0) out[s.key] = s.unite ? Math.min(n, 99) : 1
  }
  // Un seul supplément « non cumulatif » : on garde le premier de la liste (la fiche n'en propose qu'un)
  const excl = SNC_SUPPLEMENTS.filter(s => s.exclusif && out[s.key])
  for (const s of excl.slice(1)) delete out[s.key]
  return out
}

export const supplementPriceKey = (key: string, majore = false) => `siabis_sup_${key}${majore ? '_maj' : ''}`
