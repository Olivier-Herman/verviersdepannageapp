// src/lib/tarifs/grille-officielle.ts
//
// Faut-il joindre la grille tarifaire officielle au document qu'on envoie au
// client ? Une seule fonction décide, pour le reçu comme pour la facture.
//
// LE PRINCIPE. Sur un dépannage SIABIS ou une saisie judiciaire, le client
// n'a choisi ni son dépanneur ni le prix. Sa première question devant la
// facture, c'est « pourquoi si cher, et qui a décidé ça ? ». La grille
// officielle répond aux deux en une page, sans que le bureau argumente au
// téléphone.
//
// LA CONDITION, ET ELLE EST STRICTE. La grille ne protège que si la facture
// colle à ses postes. Dès qu'un montant a été fixé à la main — dispatcher qui
// corrige, chauffeur qui arrange, tarif spécial négocié — le document devient
// une arme retournée : le client compare ligne à ligne et conteste l'écart.
// Dans ce cas on ne joint RIEN, et le bureau explique de vive voix.
// Olivier 2026-08-21.

export type GrilleKey = 'siabis' | 'saisie'

export interface GrilleOfficielle {
  key:      GrilleKey
  titre:    string
  fichier:  string   // chemin public, sert aussi à lire le PDF sur disque
  source:   string   // ce qui fait autorité, cité tel quel au client
  mention:  string   // la phrase à poser sur le document
}

export const GRILLES: Record<GrilleKey, GrilleOfficielle> = {
  siabis: {
    key:     'siabis',
    titre:   'Tarifs SIABIS+ 2026',
    fichier: 'docs/tarifs-siabis-2026.pdf',
    source:  'SPW Mobilité & Infrastructures / SOFICO / Police fédérale',
    mention:
      'Tarif réglementé SIABIS+ — réseau structurant wallon. Ces montants ne sont pas fixés '
    + 'par Verviers Dépannage. La grille officielle en vigueur est jointe au présent document.',
  },
  saisie: {
    key:     'saisie',
    titre:   'Tarifs saisies judiciaires 2026',
    fichier: 'docs/tarifs-saisies-judiciaires-2026.pdf',
    source:  'Circulaire 131/13 du 16 janvier 2026 — frais de justice en matière pénale',
    mention:
      'Tarif officiel des frais de justice (circulaire 131/13 du 16 janvier 2026). Ces montants '
    + 'ne sont pas fixés par Verviers Dépannage. La grille officielle est jointe au présent document.',
  },
}

/** Sources relevant du régime SIABIS+ sur le réseau structurant wallon. */
const SOURCES_SIABIS = ['police_snc', 'sia_couvert']
/** Sources relevant du tarif des frais de justice. */
const SOURCES_SAISIE = ['police_saisie']

export interface MissionTarif {
  source?:                   string | null
  amount_to_collect_manual?: boolean | null
  special_tarif_htva?:       number | null
}

/**
 * Retourne la grille à joindre, ou null s'il ne faut rien joindre.
 *
 * null dans trois cas :
 *   · la source ne relève d'aucune grille réglementée (privé, assistance…) ;
 *   · le montant a été saisi à la main (`amount_to_collect_manual`) ;
 *   · un tarif spécial a été négocié (`special_tarif_htva`).
 */
export function grilleAJoindre(m: MissionTarif): GrilleOfficielle | null {
  const source = (m.source || '').toLowerCase().trim()

  const key: GrilleKey | null =
    SOURCES_SIABIS.includes(source) ? 'siabis'
    : SOURCES_SAISIE.includes(source) ? 'saisie'
    : null
  if (!key) return null

  // Un montant retouché à la main ne correspond plus à la grille : on se tait.
  if (m.amount_to_collect_manual === true) return null
  if (m.special_tarif_htva != null && Number(m.special_tarif_htva) > 0) return null

  return GRILLES[key]
}

/**
 * Lit le PDF de la grille et le renvoie en base64, prêt pour une pièce jointe
 * Graph ou un ir.attachment Odoo. Les fichiers sont dans public/ : ils sont
 * versionnés avec le code, donc une facture de 2026 partira toujours avec la
 * grille de 2026, même si le barème change l'an prochain.
 */
export async function lireGrilleBase64(g: GrilleOfficielle): Promise<string | null> {
  try {
    const { readFile } = await import('fs/promises')
    const { join }     = await import('path')
    const buf = await readFile(join(process.cwd(), 'public', g.fichier))
    return buf.toString('base64')
  } catch (e: any) {
    console.warn('[grille-officielle] lecture impossible:', g.fichier, e?.message)
    return null
  }
}

/** Nom du fichier tel que le client le verra dans sa boîte mail. */
export function nomFichier(g: GrilleOfficielle): string {
  return g.fichier.split('/').pop() || 'tarifs.pdf'
}
