// ============================================================
// VERVIERS DÉPANNAGE — Encaissements non affectés
// ============================================================
//
// Une transaction dont on ne retrouvera pas la facture (« Montant
// personnalisé » tapé au terminal) bloque le versement entier, donc la ligne
// bancaire, indéfiniment. L'argent est pourtant bien arrivé.
//
// La sortie de secours : décider que cette ligne part en OD sur le compte
// d'attente. Le rapprochement produit alors le débit 542 qui manquait, la
// ligne bancaire se lettre, et le montant reste visible en 499000 jusqu'à ce
// qu'on l'affecte pour de bon.
//
// La décision est enregistrée en base plutôt que prise à la volée : elle est
// datée, signée, commentée — et le versement redevient rapprochable par le
// chemin normal, garde-fous compris.

import { createAdminClient } from '@/lib/supabase'
import type { Provider }     from '@/lib/paynovate-resolve'

/** 499000 Suspense Accounts — le compte d'attente (choisi par Olivier le 19/08/2026). */
export const ACC_UNALLOCATED = 265

export interface Unallocated {
  linkKey:   string
  amount:    number
  accountId: number
  reason:    string
  createdAt: string
}

const cents = (n: number) => Math.round(n * 100) / 100
const keyOf = (linkKey: string, amount: number) => `${linkKey}|${cents(amount).toFixed(2)}`

/**
 * Les lignes déjà passées en OD, pour un lot de clés.
 *
 * Lu en bloc avant la boucle de rapprochement : une requête pour tout l'écran
 * plutôt qu'une par transaction.
 */
export async function loadUnallocated(
  provider: Provider,
  linkKeys: string[],
): Promise<Map<string, Unallocated>> {
  const out = new Map<string, Unallocated>()
  const wanted = [...new Set(linkKeys.filter(Boolean))]
  if (!wanted.length) return out

  const sb = createAdminClient()
  const { data } = await sb
    .from('payout_unallocated_lines')
    .select('link_key, amount, account_id, reason, created_at')
    .eq('provider', provider)
    .in('link_key', wanted)
    .order('id', { ascending: true })          // tri déterministe

  for (const r of data || []) {
    out.set(keyOf(String(r.link_key), Number(r.amount)), {
      linkKey:   String(r.link_key),
      amount:    Number(r.amount),
      accountId: Number(r.account_id) || ACC_UNALLOCATED,
      reason:    String(r.reason || ''),
      createdAt: String(r.created_at || ''),
    })
  }
  return out
}

/**
 * Toutes les décisions d'un prestataire.
 *
 * Pour les assureurs, la clé combine la ligne bancaire et la référence annoncée
 * — on ne peut pas la deviner avant d'avoir apparié avis et virement. Charger
 * le lot entier reste une requête, et la table n'en compte qu'une poignée.
 */
export async function loadAllUnallocated(provider: Provider): Promise<Map<string, Unallocated>> {
  const out = new Map<string, Unallocated>()
  const sb = createAdminClient()
  const { data } = await sb
    .from('payout_unallocated_lines')
    .select('link_key, amount, account_id, reason, created_at')
    .eq('provider', provider)
    .order('id', { ascending: true })

  for (const r of data || []) {
    out.set(keyOf(String(r.link_key), Number(r.amount)), {
      linkKey:   String(r.link_key),
      amount:    Number(r.amount),
      accountId: Number(r.account_id) || ACC_UNALLOCATED,
      reason:    String(r.reason || ''),
      createdAt: String(r.created_at || ''),
    })
  }
  return out
}

/** La ligne de ce lot, s'il y en a une. */
export const findUnallocated = (
  map: Map<string, Unallocated>,
  linkKey: string,
  amount: number,
) => map.get(keyOf(linkKey, amount)) ?? null

/**
 * Décide qu'une ligne part en OD.
 *
 * Le commentaire est obligatoire : c'est la seule trace lisible que le
 * comptable aura en face du montant en compte d'attente. Sans lui, on
 * retrouverait dans six mois une somme en 499000 sans savoir d'où elle sort.
 */
export async function markUnallocated(args: {
  provider: Provider
  linkKey:  string
  amount:   number
  reason:   string
  userId:   string | null
}): Promise<Unallocated> {
  const linkKey = args.linkKey.trim()
  const reason  = args.reason.trim()
  if (!linkKey) throw new Error('Ligne non identifiée')
  // Négatif accepté : un avis assureur porte aussi des reprises et des doubles
  // paiements, qui viennent en déduction du virement.
  if (!Number.isFinite(args.amount) || Math.abs(args.amount) < 0.005) {
    throw new Error('Montant invalide')
  }
  if (reason.length < 3) throw new Error('Indique en une phrase pourquoi cette ligne part en OD — ce commentaire ira dans l\'écriture')

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('payout_unallocated_lines')
    .upsert({
      provider:   args.provider,
      link_key:   linkKey,
      amount:     cents(args.amount),
      account_id: ACC_UNALLOCATED,
      reason,
      created_by: args.userId,
    }, { onConflict: 'provider,link_key,amount' })
    .select('link_key, amount, account_id, reason, created_at')
    .single()

  if (error) throw new Error(`Passage en OD non enregistré : ${error.message}`)
  return {
    linkKey:   String(data.link_key),
    amount:    Number(data.amount),
    accountId: Number(data.account_id),
    reason:    String(data.reason || ''),
    createdAt: String(data.created_at || ''),
  }
}

/** Annule la décision — on a finalement retrouvé la facture. */
export async function clearUnallocated(
  provider: Provider,
  linkKey: string,
  amount: number,
): Promise<boolean> {
  const sb = createAdminClient()
  const { error, count } = await sb
    .from('payout_unallocated_lines')
    .delete({ count: 'exact' })
    .eq('provider', provider)
    .eq('link_key', linkKey.trim())
    .eq('amount', cents(amount))
  if (error) throw new Error(`Annulation impossible : ${error.message}`)
  return (count ?? 0) > 0
}
