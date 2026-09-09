// Libellé d'un régime de gardiennage — module PUR (pas de Supabase) : importable
// depuis le navigateur (hook useGardiennageRegimeLabels) comme depuis le serveur.

export interface GardiennageRegime { regime: string; price_htva: number; price_tvac: number; free_days: number }

const EMOJI: Record<string, string> = { assistance: '🛟', saisie: '⚖️', siabis: '🛣️', autre: '📦' }
const NAME: Record<string, string> = { assistance: 'Assistance', saisie: 'Saisie', siabis: 'Siabis', autre: 'Autre' }
const eur = (n: number) => n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** Libellé complet d'un régime à partir de la grille (partagé serveur / navigateur). */
export function gardiennageRegimeLabel(regime: string, r?: GardiennageRegime | null, withEmoji = true): string {
  const head = `${withEmoji && EMOJI[regime] ? EMOJI[regime] + ' ' : ''}${NAME[regime] || regime}`
  if (!r) return head
  if (regime === 'assistance') return `${head} — ${r.free_days > 0 ? `${r.free_days} premiers jours inclus` : `${eur(r.price_tvac)} € TVAC/jour`}`
  if (regime === 'saisie') return `${head} — tarif parquet (${eur(r.price_htva)} € HTVA/jour)`
  return `${head} — ${eur(r.price_tvac)} € TVAC/jour`
}
