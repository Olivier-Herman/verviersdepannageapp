// src/lib/routing/usage.ts
//
// Compteur des calculs d'itinéraire et d'adresse (Olivier 02/10/2026) : une
// ligne par jour × fournisseur × service × origine dans `routing_usage`, lue
// par Admin → Diagnostics. Sert à savoir si le quota gratuit OpenRouteService
// suffit et à voir tout appel Google (payant).
//
// Jamais bloquant : un échec du compteur ne doit pas casser un calcul de prix.

import { createAdminClient } from '@/lib/supabase'
import { routingMode }       from '@/lib/routing/mode'

export type UsageProvider = 'memoire' | 'ors' | 'google'
export type UsageService  = 'itineraire' | 'matrice' | 'adresse'

export async function countRoutingCall(provider: UsageProvider, service: UsageService, failed = false): Promise<void> {
  try {
    await createAdminClient().rpc('routing_usage_bump', {
      p_provider: provider, p_service: service,
      p_origin: routingMode() === 'paid' ? 'humain' : 'auto',
      p_failed: failed,
    })
  } catch { /* compteur seulement */ }
}
