// src/lib/geocode/server.ts
//
// Géocodage CÔTÉ SERVEUR via OpenRouteService (Pelias), la clé ORS étant déjà
// en prod pour le routage. Google Geocoding n'est pas activé sur le projet
// (cf mémoire « géocodage = navigateur only ») — mais un tiers des fiches VAB
// n'étaient jamais ouvertes dans un navigateur avant clôture, donc jamais
// géocodées, donc « à calculer » en facturation (1HDF496, Olivier 12/09/2026).
//
// Prudence : on n'écrit des coordonnées que sur une réponse SÛRE (adresse
// exacte ou lieu nommé, confiance élevée) ; sinon on laisse la fiche telle
// quelle et la raison « à calculer » reste vraie.

const ORS_KEY  = process.env.ORS_API_KEY
const ORS_BASE = 'https://api.openrouteservice.org'

export interface GeocodeHit { lat: number; lng: number; label: string; confidence: number; layer: string }

/** « RUE DE LA GARE 4, 4900 SPA — P GARE SPA » → « RUE DE LA GARE 4, 4900 SPA ». */
export function cleanAddressForGeocode(raw: string | null | undefined): string {
  return String(raw || '')
    .split(/\s[—–]\s/)[0]          // suffixe « — nom du lieu » (VAB, Touring)
    .replace(/\s+/g, ' ')
    .trim()
}

export async function geocodeAddressServer(raw: string | null | undefined): Promise<GeocodeHit | null> {
  const text = cleanAddressForGeocode(raw)
  if (!ORS_KEY || text.length < 6) return null
  const url = `${ORS_BASE}/geocode/search?api_key=${encodeURIComponent(ORS_KEY)}&text=${encodeURIComponent(text)}&boundary.country=BE,LU,FR,NL,DE&size=3`
  let j: any = null
  try {
    const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(6000) })
    if (!r.ok) return null
    j = await r.json()
  } catch { return null }
  const feats: any[] = Array.isArray(j?.features) ? j.features : []
  for (const f of feats) {
    const p = f?.properties || {}
    const conf = Number(p.confidence || 0)
    const layer = String(p.layer || '')
    const ok = (layer === 'address' && conf >= 0.8) || ((layer === 'venue' || layer === 'street') && conf >= 0.9)
    if (!ok) continue
    const [lng, lat] = f.geometry?.coordinates || []
    if (typeof lat !== 'number' || typeof lng !== 'number') continue
    return { lat, lng, label: String(p.label || text), confidence: conf, layer }
  }
  return null
}

/** « Rue de la Cité 22a, 4800 Verviers » → « rue de la cite 22a 4800 verviers ». */
const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * NOS DÉPÔTS N'ONT PAS BESOIN DE GÉOCODEUR (Olivier 14/09/2026, 2EGQ442) : un
 * remorquage livré chez nous porte « Verviers Depannage Sa, Rue de la Cité 22a,
 * 4800 Verviers » — le géocodeur prudent refuse la raison sociale en tête, et
 * la facturation attendait « destination non géocodée » jusqu'à ce qu'on ouvre
 * la fiche. Si l'adresse contient la rue + numéro d'un dépôt actif, ce sont ses
 * coordonnées, point.
 */
export async function depotCoordsFor(sb: any, address: string | null | undefined): Promise<GeocodeHit | null> {
  const a = norm(cleanAddressForGeocode(address))
  if (a.length < 6) return null
  const { data: depots } = await sb.from('depots').select('name, address, lat, lng').eq('active', true)
  for (const d of (depots || []) as any[]) {
    if (d.lat == null || d.lng == null) continue
    const street = norm(String(d.address || '').split(',')[0])   // « rue de la cite 22 »
    if (street.length >= 6 && a.includes(street)) {
      return { lat: Number(d.lat), lng: Number(d.lng), label: `dépôt ${d.name}`, confidence: 1, layer: 'depot' }
    }
  }
  return null
}

/**
 * Pose les coordonnées manquantes d'une fiche (intervention, destination) et
 * le journalise. Best-effort : renvoie ce qui a été rempli.
 */
export async function ensureMissionCoords(sb: any, missionId: string): Promise<{ incident: boolean; destination: boolean }> {
  const out = { incident: false, destination: false }
  const { data: m } = await sb.from('incoming_missions')
    .select('id, incident_address, incident_lat, incident_lng, destination_address, destination_lat, destination_lng')
    .eq('id', missionId).maybeSingle()
  if (!m) return out
  const upd: Record<string, any> = {}
  const notes: string[] = []
  if ((m.incident_lat == null || m.incident_lng == null) && m.incident_address) {
    const h = (await depotCoordsFor(sb, m.incident_address)) || (await geocodeAddressServer(m.incident_address))
    if (h) { upd.incident_lat = h.lat; upd.incident_lng = h.lng; out.incident = true; notes.push(`intervention → ${h.label}`) }
  }
  if ((m.destination_lat == null || m.destination_lng == null) && m.destination_address) {
    const h = (await depotCoordsFor(sb, m.destination_address)) || (await geocodeAddressServer(m.destination_address))
    if (h) { upd.destination_lat = h.lat; upd.destination_lng = h.lng; out.destination = true; notes.push(`destination → ${h.label}`) }
  }
  if (!Object.keys(upd).length) return out
  upd.updated_at = new Date().toISOString()
  const { error } = await sb.from('incoming_missions').update(upd).eq('id', missionId)
  if (error) return { incident: false, destination: false }
  await sb.from('mission_logs').insert({
    mission_id: missionId, action: 'geocoded_server',
    notes: `Coordonnées posées par le serveur (OpenRouteService) : ${notes.join(' · ')}`,
    metadata: upd,
  }).then(() => {}, () => {})
  return out
}
