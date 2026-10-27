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

import { countRoutingCall } from '@/lib/routing/usage'
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
    // Tous pays (Olivier 27/10/2026 : « il ne faut pas de limite de pays ») ; region=be garde la Belgique en premier.
    + '&region=be&language=fr&key=' + encodeURIComponent(GOOGLE_KEY)
  try {
    const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(6000) })
    if (!r.ok) { void countRoutingCall('google', 'adresse', true); lastFailure = 'transient'; return null }
    const j: any = await r.json()
    const status = String(j?.status || '')
    void countRoutingCall('google', 'adresse', status !== 'OK' && status !== 'ZERO_RESULTS')
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

/** Adresse sur autoroute (« A27 DIR SAP KM 15.3 », « Aire de Polleur, E42 », « E25 sortie 46 »). */
export function isHighwayAddress(raw: string | null | undefined): boolean {
  // Prudent : « Rue X 12 boîte A 3 » ne doit pas passer pour une autoroute. L'adresse COMMENCE par
  // l'autoroute, ou la cite avec un repère (km, direction, sortie), ou parle d'aire / d'autoroute.
  const t = String(raw || '')
  return /^\s*[AE]\s?\d{1,3}\b/i.test(t) || /\bautoroute\b|\baire de\b/i.test(t)
    || /\b[AE]\s?\d{1,3}\b.*\b(km|dir|direction|sortie|ext)\b/i.test(t)
}

/**
 * AUTOROUTES (Olivier 14/10/2026, P567X / 2CNZ592 / 2EPD687) : le géocodage d'adresse ne trouve rien
 * pour « A27 DIR SAP KM 15.3 » et les fiches restaient « km inconnus » jusqu'à ce que le bureau place le
 * point. Google Places (la même recherche que les suggestions de la fiche) trouve l'aire, la sortie ou le
 * tronçon dans la commune. Position approximative (quelques km au plus), assumée et écrite dans le label.
 * Clé du navigateur, restreinte par referer : Places (New) l'accepte avec l'en-tête Referer.
 */
const RAYON_KM = 60
let depotsCache: { at: number; list: { lat: number; lng: number }[] } | null = null
async function depotsActifs(): Promise<{ lat: number; lng: number }[]> {
  if (depotsCache && Date.now() - depotsCache.at < 3600_000) return depotsCache.list
  try {
    const { createAdminClient } = await import('@/lib/supabase')
    const { data } = await createAdminClient().from('depots').select('lat, lng').eq('active', true)
    const list = (data || []).filter((d: any) => d.lat != null && d.lng != null).map((d: any) => ({ lat: Number(d.lat), lng: Number(d.lng) }))
    depotsCache = { at: Date.now(), list }
    return list
  } catch { return [] }
}
function kmEntre(a: number, b: number, c: number, d: number): number {
  const r = (x: number) => x * Math.PI / 180
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}

async function geocodeHighwayPlaces(text: string): Promise<GeocodeHit | null> {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!key) return null
  const base = process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com'
  try {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(6000),
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'Referer': base.replace(/\/?$/, '/'),
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.types' },
      body: JSON.stringify({ textQuery: text, regionCode: 'BE', languageCode: 'fr' }),
    })
    void countRoutingCall('google', 'adresse', !r.ok)
    if (!r.ok) { lastFailure = 'transient'; return null }
    const j: any = await r.json()
    // Garde-fou : un point à plus de RAYON_KM de nos dépôts n'est pas notre intervention (« E40 DIR THEUX
    // SORTIE THEUX » était tombé sur l'E40 à Bruxelles, 2FVH314, 14/10/2026).
    const proches = await depotsActifs()
    // Ordre de préférence (Olivier 22/10/2026, 1EHS211 : « A26 BK 10,6 > LIEGE » était tombé sur le « Centre
    // d'Inspection, Voie de l'Air Pur 257 », un simple point d'intérêt) : la route elle-même, puis une aire, une
    // station, un échangeur ; un point d'intérêt seulement s'il porte le nom de l'autoroute.
    const ref = text.match(/\b[AE]\s?\d{1,3}\b/i)?.[0]?.replace(/\s/g, '').toUpperCase() || ''
    const portRef = (x: any) => !!ref && String(x.displayName?.text || '').toUpperCase().replace(/\s/g, '').includes(ref)
    const rang = (x: any) => { const t: string[] = x.types || []
      if (t.includes('route')) return 0
      if (t.includes('rest_stop') || t.includes('gas_station')) return 1
      if (t.includes('intersection')) return 2
      if (t.includes('point_of_interest') && portRef(x)) return 3
      return 9 }
    const p = (j.places || [])
      .filter((x: any) => x?.location && rang(x) < 9
        && (!proches.length || proches.some(d => kmEntre(d.lat, d.lng, Number(x.location.latitude), Number(x.location.longitude)) <= RAYON_KM)))
      .sort((a: any, b: any) => rang(a) - rang(b))[0]
    if (!p) { lastFailure = 'not_found'; return null }
    lastFailure = null
    // Étiquette : l'autoroute et la commune, pas l'adresse d'un bâtiment voisin.
    const commune = String(p.formattedAddress || '').match(/\b\d{4}\s+([^,]+)/)?.[1]?.trim() || ''
    const nom = rang(p) === 0 || !p.displayName?.text ? `${ref || 'Autoroute'}${commune ? ` près de ${commune}` : ''}` : `${p.displayName.text}${commune ? `, ${commune}` : ''}`
    return { lat: Number(p.location.latitude), lng: Number(p.location.longitude), label: `${nom} (position approximative, autoroute)`, confidence: 0.6, layer: 'google:places_autoroute' }
  } catch (e: any) { lastFailure = 'transient'; console.warn('[geocode] places autoroute KO:', e?.message); return null }
}

export async function geocodeAddressServer(raw: string | null | undefined, city?: string | null): Promise<GeocodeHit | null> {
  const text = cleanAddressForGeocode(raw)
  if (text.length < 6) return null
  lastFailure = null
  if (isHighwayAddress(text)) {
    const c = String(city || '').trim()
    const h = await geocodeHighwayPlaces(c && !text.toLowerCase().includes(c.toLowerCase()) ? `${text}, ${c}` : text)
    if (h) return h
    // Texte trop chargé (« A27 - E42 ; Theux (Ext.7) - Heusy (Ext.6) ; km 8,2 … ») : l'autoroute + la commune.
    const route = text.match(/\b[AE]\s?\d{1,3}\b/i)?.[0]?.replace(/\s/g, '').toUpperCase()
    const lieu = c || text.match(/\(?\b([A-ZÀ-Ÿ][a-zà-ÿ'-]{2,})\s*\(Ext/)?.[1] || ''
    if (route && lieu) { const h2 = await geocodeHighwayPlaces(`${route}, ${lieu}`); if (h2) return h2 }
    // « … SORTIE THEUX » / « DIR THEUX » : la sortie nommée, quelle que soit l'autoroute citée.
    const sortie = text.match(/\bsortie\s+([a-zà-ÿ'-]{3,})/i)?.[1] || text.match(/\bdir(?:ection)?\.?\s+([a-zà-ÿ'-]{3,})/i)?.[1]
    if (sortie) { const h3 = await geocodeHighwayPlaces(`sortie autoroute ${sortie}`); if (h3) return h3 }
  }

  // Google d'abord : c'est ce que fait le navigateur, et il lit les adresses
  // des assisteurs (« qteam, CHAINEUX,HERVE, BEL » → le garage QTeam, pas le
  // village). ORS reste en repli si Google est absent ou en erreur.
  const g = await geocodeGoogle(text)
  if (g) return g
  if (lastFailure === 'not_found' && GOOGLE_KEY) return null   // Google a cherché, il n'y a rien : ORS ne fera pas mieux

  if (!ORS_KEY) return null
  const url = `${ORS_BASE}/geocode/search?api_key=${encodeURIComponent(ORS_KEY)}&text=${encodeURIComponent(text)}&focus.point.lat=50.59&focus.point.lon=5.86&size=3`   // tous pays, proches de Verviers d'abord (27/10/2026)
  let j: any = null
  try {
    const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(6000) })
    if (!r.ok) { void countRoutingCall('ors', 'adresse', true); lastFailure = 'transient'; return null }
    j = await r.json()
    void countRoutingCall('ors', 'adresse', !!j?.error)
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
    .select('id, incident_address, incident_city, incident_lat, incident_lng, destination_address, destination_lat, destination_lng')
    .eq('id', missionId).maybeSingle()
  if (!m) return out
  const upd: Record<string, any> = {}
  const notes: string[] = []
  let transient = false
  if ((m.incident_lat == null || m.incident_lng == null) && m.incident_address) {
    const h = (await depotCoordsFor(sb, m.incident_address)) || (await geocodeAddressServer(m.incident_address, m.incident_city))
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

/**
 * Adresses Google candidates pour un texte non reconnu (Sam copilote, 14/10/2026) : même recherche que les
 * suggestions de la fiche, jusqu'à `max` résultats ; `proche` = seulement à moins de RAYON_KM de nos dépôts.
 */
export async function placesCandidates(text: string, opts: { max?: number; proche?: boolean; rayonKm?: number } = {}): Promise<{ label: string; lat: number; lng: number }[]> {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  const q = String(text || '').replace(/\b(belgique|belgie|belgium|bel)\b\.?/gi, '').replace(/[,\s]+$/g, '').trim()
  if (!key || q.length < 4) return []
  const base = process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com'
  try {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(6000),
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'Referer': base.replace(/\/?$/, '/'),
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.types' },
      body: JSON.stringify({ textQuery: q, regionCode: 'BE', languageCode: 'fr', maxResultCount: Math.min(5, opts.max || 3) }),
    })
    void countRoutingCall('google', 'adresse', !r.ok)
    if (!r.ok) return []
    const j: any = await r.json()
    const rayon = opts.rayonKm ?? (opts.proche ? RAYON_KM : 0)
    const proches = rayon ? await depotsActifs() : []
    const out: { label: string; lat: number; lng: number }[] = []
    for (const p of j.places || []) {
      if (!p?.location) continue
      const lat = Number(p.location.latitude), lng = Number(p.location.longitude)
      if (proches.length && !proches.some(d => kmEntre(d.lat, d.lng, lat, lng) <= rayon)) continue
      const addr = String(p.formattedAddress || '')
      const nom = String(p.displayName?.text || '')
      const estab = (p.types || []).some((t: string) => t === 'establishment' || t === 'point_of_interest')
      out.push({ label: estab && nom && !addr.startsWith(nom) ? `${nom}, ${addr}` : (addr || nom), lat, lng })
      if (out.length >= (opts.max || 3)) break
    }
    return out
  } catch { return [] }
}
