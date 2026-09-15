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

// Clé Google SERVEUR (sans restriction de domaine) : la même que le routage et
// les dépôts. Le 15/09/2026, deux fiches (10147028, 10145716) sont restées
// « kilomètres inconnus » 13 h : ce géocodeur n'appelait qu'ORS, dont le quota
// gratuit était épuisé — et la clé Google serveur existait depuis 76 jours.
const GOOGLE_KEY = process.env.GOOGLE_GEOCODING || process.env.GOOGLE_MAPS_SERVER_KEY

// Échecs PASSAGERS (quota, réseau) par fiche, le temps que la raison remonte
// jusqu'à la facturation : « service saturé, recalcul automatique » n'est pas
// « adresse introuvable, ouvre la fiche ». Mémoire d'instance, TTL court.
const transientFail = new Map<string, number>()
export function noteTransientGeocodeFailure(missionId: string) { transientFail.set(missionId, Date.now() + 15 * 60_000) }
export function wasTransientGeocodeFailure(missionId: string | null | undefined): boolean {
  if (!missionId) return false
  const exp = transientFail.get(missionId)
  if (!exp) return false
  if (exp < Date.now()) { transientFail.delete(missionId); return false }
  return true
}
/** Dernier échec du géocodage : 'transient' (quota/réseau) ou 'not_found'. */
let lastFailure: 'transient' | 'not_found' | null = null
export function lastGeocodeFailure() { return lastFailure }

/** Google Geocoding API, clé serveur. null si pas de clé, introuvable, ou erreur. */
async function geocodeGoogle(text: string): Promise<GeocodeHit | null> {
  if (!GOOGLE_KEY) return null
  const url = 'https://maps.googleapis.com/maps/api/geocode/json?address=' + encodeURIComponent(text)
    + '&region=be&components=country:BE|country:LU|country:FR|country:NL|country:DE&language=fr&key=' + encodeURIComponent(GOOGLE_KEY)
  try {
    const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(6000) })
    if (!r.ok) { lastFailure = 'transient'; return null }
    const j: any = await r.json()
    const status = String(j?.status || '')
    if (status === 'ZERO_RESULTS') { lastFailure = 'not_found'; return null }
    if (status !== 'OK') { lastFailure = 'transient'; console.warn('[geocode] google', status, j?.error_message); return null }
    const res = (j.results || []).find((x: any) => !x.partial_match) || j.results?.[0]
    const loc = res?.geometry?.location
    if (!loc) { lastFailure = 'not_found'; return null }
    const lt = String(res.geometry?.location_type || '')
    // ROOFTOP / RANGE_INTERPOLATED = une adresse ; GEOMETRIC_CENTER = un lieu
    // nommé (garage, zoning) ; APPROXIMATE = une localité (« Chaineux, 4650
    // Herve »). On la prend quand même, confiance basse : le navigateur fait
    // pareil, et un centre de village vaut mieux qu'une facture qui n'existe
    // pas — le label dit ce qui a été retenu.
    lastFailure = null
    const confidence = lt === 'ROOFTOP' ? 1 : lt === 'APPROXIMATE' ? 0.6 : 0.9
    return { lat: Number(loc.lat), lng: Number(loc.lng), label: String(res.formatted_address || text), confidence, layer: 'google:' + lt }
  } catch (e: any) { lastFailure = 'transient'; console.warn('[geocode] google KO:', e?.message); return null }
}

/** « RUE DE LA GARE 4, 4900 SPA — P GARE SPA » → « RUE DE LA GARE 4, 4900 SPA ». */
export function cleanAddressForGeocode(raw: string | null | undefined): string {
  return String(raw || '')
    .split(/\s[—–]\s/)[0]          // suffixe « — nom du lieu » (VAB, Touring)
    .replace(/\s+/g, ' ')
    .trim()
}

export async function geocodeAddressServer(raw: string | null | undefined): Promise<GeocodeHit | null> {
  const text = cleanAddressForGeocode(raw)
  if (text.length < 6) return null
  lastFailure = null

  // Google d'abord : c'est ce que fait le navigateur, et il lit les adresses
  // des assisteurs (« qteam, CHAINEUX,HERVE, BEL » → le garage QTeam, pas le
  // village). ORS reste en repli si Google est absent ou en erreur.
  const g = await geocodeGoogle(text)
  if (g) return g
  if (lastFailure === 'not_found' && GOOGLE_KEY) return null   // Google a cherché, il n'y a rien : ORS ne fera pas mieux

  if (!ORS_KEY) return null
  const url = `${ORS_BASE}/geocode/search?api_key=${encodeURIComponent(ORS_KEY)}&text=${encodeURIComponent(text)}&boundary.country=BE,LU,FR,NL,DE&size=3`
  let j: any = null
  try {
    const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(6000) })
    if (!r.ok) { lastFailure = 'transient'; return null }
    j = await r.json()
    if (j?.error) { lastFailure = 'transient'; console.warn('[geocode] ors:', j.error); return null }   // « Quota exceeded » arrive en 200
  } catch { lastFailure = 'transient'; return null }
  const feats: any[] = Array.isArray(j?.features) ? j.features : []
  if (!feats.length) lastFailure = 'not_found'
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
  let transient = false
  if ((m.incident_lat == null || m.incident_lng == null) && m.incident_address) {
    const h = (await depotCoordsFor(sb, m.incident_address)) || (await geocodeAddressServer(m.incident_address))
    if (h) { upd.incident_lat = h.lat; upd.incident_lng = h.lng; out.incident = true; notes.push(`intervention → ${h.label}`) }
    else if (lastFailure === 'transient') transient = true
  }
  if ((m.destination_lat == null || m.destination_lng == null) && m.destination_address) {
    const h = (await depotCoordsFor(sb, m.destination_address)) || (await geocodeAddressServer(m.destination_address))
    if (h) { upd.destination_lat = h.lat; upd.destination_lng = h.lng; out.destination = true; notes.push(`destination → ${h.label}`) }
    else if (lastFailure === 'transient') transient = true
  }
  if (transient) noteTransientGeocodeFailure(missionId)
  if (!Object.keys(upd).length) return out
  upd.updated_at = new Date().toISOString()
  const { error } = await sb.from('incoming_missions').update(upd).eq('id', missionId)
  if (error) return { incident: false, destination: false }
  await sb.from('mission_logs').insert({
    mission_id: missionId, action: 'geocoded_server',
    notes: `Coordonnées posées par le serveur : ${notes.join(' · ')}`,
    metadata: upd,
  }).then(() => {}, () => {})
  return out
}
