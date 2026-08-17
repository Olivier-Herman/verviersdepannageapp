// src/lib/facturation/solde.ts
//
// CE QUI RESTE DÛ SUR UN DOSSIER (Olivier 2026-08-17).
//
// Jusqu'ici la facture partielle écrivait au registre `mission_billed_items`,
// mais personne ne le LISAIT pour soustraire : l'estimation affichait encore le
// total, et la facture de clôture reproposait ce qui était déjà payé. Trois
// écrans, trois calculs, et le désaccord garanti.
//
// Ici, un seul calcul. Il rend trois blocs — déjà facturé, reste à facturer,
// totaux — et tout le monde s'en sert.
//
// ── LE GARDIENNAGE N'EST PAS UNE QUANTITÉ, C'EST UN INTERVALLE ───────────────
// Règle Olivier : jours CALENDRIER, **jour d'entrée non compté**. Entré lundi,
// sorti mardi = 1 jour. Entré et sorti le même jour = 0.
// Le registre garde le premier et le dernier jour facturé ; la tranche suivante
// reprend au LENDEMAIN du dernier jour facturé. Aucun jour compté deux fois,
// aucun jour perdu, et personne n'a à s'en souvenir.
//
// Une avance reste ACQUISE (Olivier) : si le client paie jusqu'au 20 et que le
// véhicule part le 18, on ne rembourse pas et il ne reste rien à facturer. Le
// solde ne regarde donc jamais en arrière.

/** Un poste déjà facturé, tel qu'il vit dans `mission_billed_items`. */
export interface PosteFacture {
  id?:             string
  kind:            string
  label:           string
  qty:             number
  price_unit:      number
  amount_htva:     number
  period_from:     string | null
  period_to:       string | null
  billed_at?:      string
  billed_to_id?:   number | null
  billed_to_name?: string | null
  odoo_quote_id?:  number | null
}

const JOUR_MS = 86_400_000
const jour = (d: string | Date): string => new Date(d).toISOString().slice(0, 10)
const plusUnJour = (d: string): string => jour(new Date(new Date(d).getTime() + JOUR_MS))

/**
 * Nombre de jours facturables entre deux dates INCLUSES.
 * `du` et `au` sont des jours calendrier (YYYY-MM-DD).
 */
export function joursEntre(du: string, au: string): number {
  const a = new Date(`${jour(du)}T00:00:00Z`).getTime()
  const b = new Date(`${jour(au)}T00:00:00Z`).getTime()
  return b < a ? 0 : Math.round((b - a) / JOUR_MS) + 1
}

/**
 * Premier jour de gardiennage FACTURABLE : le lendemain de l'entrée en parc, ou
 * le lendemain du dernier jour déjà facturé si une tranche a déjà été émise.
 * Renvoie null si tout est déjà couvert au-delà de la date demandée.
 */
export function prochainJourFacturable(
  entreeParc: string | Date,
  dejaFactures: PosteFacture[],
): string {
  const debut = plusUnJour(jour(entreeParc))
  const fins = dejaFactures
    .filter(p => p.kind === 'SERV-PARC' && p.period_to)
    .map(p => jour(p.period_to as string))
    .sort()
  const derniere = fins[fins.length - 1]
  return derniere && derniere >= debut ? plusUnJour(derniere) : debut
}

/**
 * La période demandée chevauche-t-elle une tranche déjà facturée ?
 * Renvoie la tranche fautive, ou null. C'est le garde-fou qui empêche de
 * facturer deux fois les mêmes jours quand deux personnes traitent le dossier à
 * deux jours d'intervalle.
 */
export function chevauchement(
  du: string, au: string, dejaFactures: PosteFacture[],
): PosteFacture | null {
  const d = jour(du), a = jour(au)
  for (const p of dejaFactures) {
    if (p.kind !== 'SERV-PARC' || !p.period_from || !p.period_to) continue
    const pf = jour(p.period_from), pt = jour(p.period_to)
    if (d <= pt && a >= pf) return p
  }
  return null
}

export interface LigneDevis {
  kind: string; name: string; qty: number; price_unit: number
  [k: string]: any
}

export interface Solde {
  /** Postes déjà facturés — affichés BARRÉS, jamais masqués. */
  factures:   PosteFacture[]
  /** Ce qui reste à facturer, prêt à partir en devis. */
  restantes:  LigneDevis[]
  totalFactureHtva: number
  totalRestantHtva: number
  /** Gardiennage : à partir de quel jour la prochaine tranche démarre. */
  parcProchainJour: string | null
}

/**
 * Soustrait du devis complet ce qui a déjà été facturé.
 *
 * · postes forfaitaires (prise en charge, km, divers, majorations) : une fois
 *   facturés, ils disparaissent du reste — on ne facture pas deux fois un
 *   forfait ;
 * · gardiennage : traité en intervalle, pas en quantité (cf. en-tête).
 */
export function calculerSolde(
  lignesCompletes: LigneDevis[],
  dejaFactures: PosteFacture[],
  parc?: { entree?: string | Date | null; jusqua?: string | Date | null },
): Solde {
  const kindsFactures = new Set(
    dejaFactures.filter(p => p.kind !== 'SERV-PARC').map(p => p.kind),
  )

  const restantes: LigneDevis[] = []
  for (const l of lignesCompletes) {
    if (l.kind === 'SERV-PARC') continue          // recalculé ci-dessous
    if (kindsFactures.has(l.kind)) continue        // forfait déjà réglé
    restantes.push(l)
  }

  // Gardiennage restant = du prochain jour facturable jusqu'à la date visée.
  let parcProchainJour: string | null = null
  if (parc?.entree) {
    const depuis = prochainJourFacturable(parc.entree, dejaFactures)
    parcProchainJour = depuis
    const jusqua = jour(parc.jusqua || new Date())
    const nb = joursEntre(depuis, jusqua)
    if (nb > 0) {
      const modele = lignesCompletes.find(l => l.kind === 'SERV-PARC')
      const pu = modele?.price_unit ?? 0
      if (pu > 0) {
        restantes.push({
          kind: 'SERV-PARC',
          name: `Frais de parc (${nb} jour${nb > 1 ? 's' : ''}, du ${depuis} au ${jusqua})`,
          qty: nb, price_unit: pu,
          period_from: depuis, period_to: jusqua,
        })
      }
    }
  }

  const somme = (n: number, l: { qty: number; price_unit: number }) => n + l.qty * l.price_unit
  return {
    factures: dejaFactures,
    restantes,
    totalFactureHtva: dejaFactures.reduce((n, p) => n + Number(p.amount_htva || 0), 0),
    totalRestantHtva: restantes.reduce(somme, 0),
    parcProchainJour,
  }
}
