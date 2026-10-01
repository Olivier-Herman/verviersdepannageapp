// src/lib/routing/mode.ts
//
// Qui a le droit de payer un calcul d'itinéraire (Olivier 02/10/2026).
//
// Google Routes / Distance Matrix est payant. Il ne sert plus que sur un GESTE
// humain : le bouton « Calculer » du bloc Estimation tarif, la facturation
// (modal Facturer, devis, facture, facture partielle) et l'encaissement ou la
// restitution. Les robots (crons) et les écrans qui s'affichent seuls restent
// sur la mémoire des trajets et OpenRouteService (gratuit).
//
// Trois modes, portés par la requête (AsyncLocalStorage, donc sans changer la
// signature des fonctions de calcul) :
//   - 'cache' : mémoire seulement, aucun appel réseau. Un trajet inconnu est
//               signalé « à calculer » (ouverture d'une fiche).
//   - 'free'  : mémoire puis OpenRouteService. Défaut partout.
//   - 'paid'  : mémoire, OpenRouteService, puis Google si ORS lâche.

import { AsyncLocalStorage } from 'async_hooks'

export type RoutingMode = 'cache' | 'free' | 'paid'

interface RoutingContext {
  mode: RoutingMode
  /** Un trajet manquait en mode 'cache' : le prix doit dire « à calculer ». */
  pending: boolean
}

const als = new AsyncLocalStorage<RoutingContext>()

export function withRoutingMode<T>(mode: RoutingMode, fn: () => Promise<T>): Promise<T> {
  return als.run({ mode, pending: false }, fn)
}

export function routingMode(): RoutingMode {
  return als.getStore()?.mode ?? 'free'
}

export function markRoutePending(): void {
  const ctx = als.getStore()
  if (ctx) ctx.pending = true
}

export function routePending(): boolean {
  return als.getStore()?.pending ?? false
}

/**
 * Mode demandé par l'écran : `?calcul=oui` (geste humain, Google autorisé),
 * `?calcul=memoire` (affichage seul), sinon gratuit. Un appel interne de robot
 * n'a jamais droit à Google, même s'il passe le paramètre.
 */
export function routingModeFromRequest(req: Request, opts: { internal?: boolean } = {}): RoutingMode {
  const v = new URL(req.url).searchParams.get('calcul')
  if (v === 'memoire') return 'cache'
  if (v === 'oui' && !opts.internal) return 'paid'
  return 'free'
}
