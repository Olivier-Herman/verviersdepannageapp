// src/lib/parc/relivraison-zone.ts
//
// Choix de la zone de relivraison selon l'adresse de destination.
//   - K1 « En attente d'adresse » : adresse absente OU = un de NOS dépôts
//     (Verviers Dépannage) → on ne peut pas encore relivrer, le véhicule attend.
//   - K  : file de relivraison normale (vraie destination connue).
// Le dispatch peut aussi transférer manuellement entre K et K1.
// Olivier 2026-07-13.

import type { createAdminClient } from '@/lib/supabase'

const norm = (s: string | null | undefined) =>
  (s || '').toLowerCase().replace(/[\s,.\-]+/g, ' ').trim()

/** Texte qui tient lieu d'adresse sans en être une : « Choix du client – Keuze »
 *  (Touring laisse le client choisir son garage), « à définir », « à confirmer »…
 *  Olivier 22/09/2026 (2GLN102) : ce n'est pas une adresse → K1, et le
 *  gardiennage ne s'arrête pas dessus. */
export function isPlaceholderAddress(addr: string | null | undefined): boolean {
  const a = norm(addr).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (!a) return false
  return /choix du client|keuze|a definir|a confirmer|a preciser|inconnu|non communique|en attente/.test(a)
}
const STOP = new Set(['rue', 'avenue', 'av', 'chaussee', 'route', 'rte', 'place', 'boulevard', 'bd', 'quai', 'chemin', 'impasse', 'allee',
  'de', 'du', 'des', 'la', 'le', 'les', 'en', 'sur', 'et', 'belgique', 'belgie', 'bel', 'be', 'bat', 'boite', 'bte'])
function placeTokens(addr: string | null | undefined) {
  const t = norm(addr).normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(Boolean)
  const nums = new Set(t.filter(x => /^\d{1,3}[a-z]?$/.test(x)).map(x => x.replace(/[a-z]$/, '')))   // n° de maison (pas les codes postaux)
  const words = new Set(t.filter(x => /^[a-z]{3,}$/.test(x) && !STOP.has(x)))
  return { nums, words }
}
/** Même lieu écrit autrement ? (« Avenue Reine Astrid 124, SPA, BEL » = « Carrosserie Fontaine, Av. Reine
 *  Astrid 124, 4900 Spa » ; « R DE LA CITE 22A, VERVIERS » = « Rue de la Cité 22, 4800 Verviers »).
 *  Même numéro de maison ET au moins deux mots en commun. 2EXG520, Olivier 08/10/2026. */
export function samePlace(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!norm(a) || !norm(b)) return false
  if (norm(a) === norm(b)) return true
  const A = placeTokens(a), B = placeTokens(b)
  const num = [...A.nums].some(n => B.nums.has(n))
  const words = [...A.words].filter(w => B.words.has(w)).length
  return num && words >= 2
}

/** L'adresse correspond-elle à un de NOS dépôts (donc pas une vraie destination) ? */
export async function isOwnDepotAddress(
  sb: ReturnType<typeof createAdminClient>,
  addr: string | null | undefined,
): Promise<boolean> {
  const a = norm(addr)
  if (!a) return false
  // Repli texte : nos dépôts portent le nom « Verviers Dépannage ».
  if (a.includes('verviers depannage')) return true
  const { data } = await sb.from('depots').select('address').eq('active', true)
  return (data || []).some((d: any) => {
    const da = norm(d.address)
    return da.length > 8 && (a.includes(da) || da.includes(a) || samePlace(addr, d.address))
  })
}

/** Une vraie adresse de relivraison (ni vide, ni « à définir », ni un de nos dépôts) ? */
export async function isRealRedelivery(sb: ReturnType<typeof createAdminClient>, addr: string | null | undefined): Promise<boolean> {
  return !!norm(addr) && !isPlaceholderAddress(addr) && !(await isOwnDepotAddress(sb, addr))
}

/**
 * Adresse de relivraison à retenir quand une commande d'assistance arrive sur un véhicule au parc.
 * Règles (2EXG520, Olivier 08/10/2026 : l'adresse saisie a été remplacée par notre dépôt) :
 *  - l'adresse de la commande n'est retenue que si c'est une VRAIE destination (jamais notre dépôt) ;
 *  - une vraie adresse déjà sur la fiche n'est jamais écrasée : si la commande en donne une autre,
 *    on le signale (`conflit`) et le dispatch tranche ;
 *  - `changed` = l'adresse change vraiment de lieu (sinon pas de nouvelle étiquette).
 */
export async function resolveRedelivery(
  sb: ReturnType<typeof createAdminClient>,
  existing: string | null | undefined,
  incoming: string | null | undefined,
  incomingName?: string | null,
): Promise<{ address: string | null; fromIncoming: boolean; changed: boolean; conflit: string | null }> {
  const cur = (existing || '').trim() || null
  const inc = (incoming || '').trim() || null
  const incReal = !!inc && (await isRealRedelivery(sb, inc)) && !(await isOwnDepotAddress(sb, incomingName))
  const curReal = !!cur && (await isRealRedelivery(sb, cur))
  if (curReal) {
    return { address: cur, fromIncoming: false, changed: false, conflit: incReal && !samePlace(cur, inc) ? inc : null }
  }
  if (incReal) return { address: inc, fromIncoming: true, changed: !samePlace(cur, inc), conflit: null }
  return { address: cur, fromIncoming: false, changed: false, conflit: null }
}

/** Zone de relivraison cible (K ou K1) selon l'adresse. */
export async function relivraisonZoneFor(
  sb: ReturnType<typeof createAdminClient>,
  addr: string | null | undefined,
): Promise<'K' | 'K1'> {
  if (!norm(addr) || isPlaceholderAddress(addr)) return 'K1'
  return (await isOwnDepotAddress(sb, addr)) ? 'K1' : 'K'
}
