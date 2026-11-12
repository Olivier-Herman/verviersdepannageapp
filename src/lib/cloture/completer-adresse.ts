// src/lib/cloture/completer-adresse.ts
//
// L'adresse de livraison est bonne, il ne manque que le code postal (Olivier 12/11/2026,
// Fred Bovy, 1VGN930 : IMA envoie « Rue Pisseroule 176, DISON, BEL »). Le chauffeur n'a pas
// à la réencoder : la carte connaît le code postal. On le reprend du géocodeur quand
// l'adresse trouvée est la même (même rue, même numéro) et, si la fiche est déjà placée
// sur la carte, à moins de 150 m. Sinon, rien ne change et on demande au chauffeur.

import { adresseComplete, splitAddress } from '@/lib/address-parts'

const distM = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Complète l'adresse de livraison de la fiche par la carte. Renvoie la nouvelle adresse, ou null. */
export async function completerAdresseParCarte(sb: any, missionId: string): Promise<string | null> {
  try {
    const { data: m } = await sb.from('incoming_missions')
      .select('id, destination_address, destination_lat, destination_lng').eq('id', missionId).maybeSingle()
    const avant = String((m as any)?.destination_address || '').trim()
    if (!avant || adresseComplete(avant)) return null
    const p = splitAddress(avant)
    if (!p.street || !p.number) return null   // sans rue ni numéro, c'est au chauffeur de dire où

    const { geocodeAddressServer } = await import('@/lib/geocode/server')
    const hit = await geocodeAddressServer(avant)
    if (!hit || !adresseComplete(hit.label)) return null
    const h = splitAddress(hit.label)
    if (!h.zip || h.number !== p.number) return null
    const { sameAddress } = await import('@/lib/missions/address-change')
    if (!sameAddress(`${p.street} ${p.number}`, hit.label)) return null   // la rue et le numéro, sans le nom en tête
    const lat = (m as any).destination_lat, lng = (m as any).destination_lng
    if (lat != null && lng != null && distM({ lat: Number(lat), lng: Number(lng) }, hit) > 150) return null

    // Le nom en tête (« Pneus Soret, … ») est gardé ; la rue et le numéro aussi, tels quels.
    const segs = avant.split(',').map(s => s.trim()).filter(Boolean)
    const iRue = segs.findIndex(s => s.endsWith(p.number) && s.includes(p.street))
    const tete = iRue > 0 ? segs.slice(0, iRue).join(', ') + ', ' : ''
    const apres = `${tete}${p.street} ${p.number}, ${h.zip} ${h.city || p.city}`.trim()
    if (!adresseComplete(apres)) return null

    const patch: Record<string, any> = { destination_address: apres, updated_at: new Date().toISOString() }
    if (lat == null || lng == null) { patch.destination_lat = hit.lat; patch.destination_lng = hit.lng }
    const { error } = await sb.from('incoming_missions').update(patch).eq('id', missionId)
    if (error) return null
    await sb.from('mission_logs').insert({
      mission_id: missionId, actor_id: null, action: 'destination_completee',
      notes: `Code postal de l'adresse de livraison repris de la carte : ${avant} → ${apres}`,
      metadata: { avant, apres, via: 'carte' },
    }).then(() => {}, () => {})
    return apres
  } catch { return null }
}
