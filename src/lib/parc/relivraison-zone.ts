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
    return da.length > 8 && (a.includes(da) || da.includes(a))
  })
}

/** Zone de relivraison cible (K ou K1) selon l'adresse. */
export async function relivraisonZoneFor(
  sb: ReturnType<typeof createAdminClient>,
  addr: string | null | undefined,
): Promise<'K' | 'K1'> {
  if (!norm(addr)) return 'K1'
  return (await isOwnDepotAddress(sb, addr)) ? 'K1' : 'K'
}
