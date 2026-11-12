// Fiches hors ligne (Olivier 12/11/2026, après la panne Orange du 11/11).
//
// Sans réseau, l'app iPhone ouvre un écran « Créer une fiche hors ligne », intégré à
// l'app (plugin natif FichesHorsLigne). La fiche reste dans le téléphone. Ici, côté site :
//   - copierListes()  garde dans le téléphone ce dont l'écran hors ligne a besoin
//                     (zones de police, motifs de saisie, marques) ;
//   - envoyerFiches() au retour du réseau, pousse chaque fiche par le même chemin
//                     qu'une fiche faite en ligne (fiche, étiquettes, TowSoft…).
// Le téléphone donne à chaque fiche un identifiant : le serveur ne la crée qu'une fois.
//
// Jamais `await` sur le proxy d'un plugin Capacitor (CLAUDE.md) : on passe par
// window.Capacitor.Plugins, et seulement si le plugin existe dans cette version de l'app.

export type FicheHorsLigne = {
  id: string
  createdAt: string          // enregistrement dans le téléphone (ISO)
  type: 'accident' | 'saisie' | 'rodeo' | 'mal_garee' | 'avp' | 'appel_prive' | 'siabis'
  date: string               // jj-mm-aaaa
  time: string               // hh:mm
  interventionAt?: string    // ISO, calculé par le téléphone (heure belge)
  plate?: string
  vin?: string
  brand?: string
  model?: string
  location?: string
  lat?: number | null
  lng?: number | null
  policeZone?: string
  officerName?: string
  ownerFirstName?: string
  ownerLastName?: string
  ownerPhone?: string
  remarks?: string
  policeBlocked?: boolean
  sncRequiresBalisage?: boolean
  malGareeScenario?: 'chargement' | 'deplacement_paye'
  appelPriveType?: 'DSP' | 'REM' | ''
  appelPriveDestination?: 'client' | 'depot' | ''
  destination?: string
  amountToCollect?: string
  saisieMotifCode?: string
  saisieMotifLabel?: string
}

type EnAttente = { id: string; fiche: FicheHorsLigne; photos: string[] }   // photos : JPEG en base64

interface Plugin {
  saveLists(o: { lists: any }): Promise<any>
  pending(): Promise<{ fiches: EnAttente[] }>
  markSent(o: { id: string; missionId: string; missionNumber?: number | null; message?: string }): Promise<any>
  markFailed(o: { id: string; error: string; final: boolean }): Promise<any>
  save(o: { fiche: FicheHorsLigne; photos: string[] }): Promise<{ id: string }>
  open(): Promise<any>
}

export function pluginHorsLigne(): Plugin | null {
  if (typeof window === 'undefined') return null
  const C = (window as any).Capacitor
  if (!C?.isNativePlatform?.()) return null
  if (C.isPluginAvailable && !C.isPluginAvailable('FichesHorsLigne')) return null
  return C.Plugins?.FichesHorsLigne ?? null
}

// ── Listes gardées dans le téléphone ────────────────────────────────────────
export async function copierListes(): Promise<void> {
  const p = pluginHorsLigne(); if (!p) return
  const get = (u: string) => fetch(u, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null)
  const [z, m, b] = await Promise.all([get('/api/police-zones'), get('/api/saisie-motifs'), get('/api/vehicles?type=brands')])
  const zones  = Array.isArray(z?.zones) ? z.zones.map((x: any) => ({ name: x.name, is_default: !!x.is_default })) : []
  const motifs = Array.isArray(m?.motifs) ? m.motifs.map((x: any) => ({ code: x.code, label: x.label_short || x.label })) : []
  const brands = Array.isArray(b) ? b.map((x: any) => String(x.name || '')).filter(Boolean) : []
  if (!zones.length && !motifs.length && !brands.length) return   // rien reçu : on garde l'ancienne copie
  await p.saveLists({ lists: { zones, motifs, brands, savedAt: new Date().toISOString() } })
}

// ── Envoi au retour du réseau ───────────────────────────────────────────────
class Reessayer extends Error {}     // réseau ou serveur indisponible : on retentera
class Refus extends Error {}         // le programme refuse la fiche : le chauffeur et le dispatch doivent voir pourquoi

const b64ToFile = (b64: string, i: number) => {
  const bin = atob(b64.replace(/^data:[^,]+,/, ''))
  const u8 = new Uint8Array(bin.length)
  for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k)
  return new File([u8], `hors-ligne-${i + 1}.jpg`, { type: 'image/jpeg' })
}

async function json(r: Response) { return r.json().catch(() => ({})) }

async function envoyerPhotos(f: FicheHorsLigne, photos: string[]): Promise<string[]> {
  if (!photos.length) return []
  const fd = new FormData()
  fd.append('mission_id', `hors-ligne-${f.id}`)
  photos.forEach((p, i) => fd.append('files', b64ToFile(p, i)))
  const r = await fetch('/api/missions/photos-upload', { method: 'POST', body: fd }).catch(() => null)
  if (!r || !r.ok) throw new Reessayer('photos')
  const j = await json(r)
  return Array.isArray(j.urls) ? j.urls : []
}

async function lieuLisible(f: FicheHorsLigne): Promise<string> {
  if (f.location?.trim()) return f.location.trim()
  if (typeof f.lat !== 'number' || typeof f.lng !== 'number') return 'Lieu non précisé (fiche faite hors ligne)'
  let label = `${f.lat.toFixed(6)}, ${f.lng.toFixed(6)}`
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${f.lat}&lon=${f.lng}&format=json`, { headers: { 'Accept-Language': 'fr' } })
    const d = await r.json()
    if (d?.display_name) label = d.display_name
  } catch { /* on garde les coordonnées */ }
  return label
}

const hhmm = (iso: string) => { try { return new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }) } catch { return '' } }
const jjmm = (iso: string) => { try { return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Brussels' }) } catch { return '' } }

type Resultat = { missionId: string; missionNumber?: number | null; message?: string }

async function envoyerUne(f: FicheHorsLigne, photos: string[]): Promise<Resultat> {
  let type: string = f.type
  // Siabis : même règle qu'en ligne, vérifiée maintenant que le réseau est là.
  // Fiche reçue de l'assistance → on la prend ; déjà à lui → rien à créer ; aucune → non couvert.
  if (type === 'siabis') {
    const plaque = (f.plate || '').trim()
    if (plaque.replace(/[-.\s_/]/g, '').length >= 6) {
      const r = await fetch(`/api/missions/dispo-summary?plate=${encodeURIComponent(plaque)}`, { cache: 'no-store' }).catch(() => null)
      if (!r || !r.ok) throw new Reessayer('siabis')
      const j = await json(r)
      if (j.mine?.length) return { missionId: j.mine[0].id, missionNumber: j.mine[0].mission_number, message: 'La fiche de l’assistance était déjà à toi.' }
      if (j.others?.length) throw new Refus(`Une fiche de l’assistance existe déjà pour cette plaque, prise par ${j.others[0].driver || 'un autre chauffeur'} : appelle le dispatch.`)
      if (j.rows?.length) {
        const c = await fetch(`/api/missions/${j.rows[0].id}/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ via: 'siabis' }) }).catch(() => null)
        if (!c) throw new Reessayer('claim')
        const cj = await json(c)
        if (!c.ok) throw new Refus(cj.error || 'La fiche de l’assistance n’a pas pu être prise : appelle le dispatch.')
        return { missionId: j.rows[0].id, missionNumber: j.rows[0].mission_number, message: 'Fiche de l’assistance reprise (photos de la fiche hors ligne à rajouter).' }
      }
    }
    type = 'snc'
  }

  const photoUrls = await envoyerPhotos(f, photos)
  const location = await lieuLisible(f)
  const fait = f.createdAt || new Date().toISOString()
  const mention = `📵 Fiche faite hors ligne le ${jjmm(fait)} à ${hhmm(fait)}, envoyée à ${hhmm(new Date().toISOString())}.`
  const remarks = [mention, f.remarks?.trim()].filter(Boolean).join('\n')
  const plate = (f.plate || '').trim().toUpperCase()

  const immediat =
    (type === 'mal_garee' && f.malGareeScenario === 'deplacement_paye') ||
    (type === 'appel_prive' && (f.appelPriveType === 'DSP' || (f.appelPriveType === 'REM' && f.appelPriveDestination === 'client')))

  const body = {
    type, date: f.date, time: f.time, intervention_at: f.interventionAt || fait,
    plate: plate || (f.vin || '').trim(), vin: f.vin || '', brand: f.brand || '', model: f.model || '',
    location, policeZone: f.policeZone || '', officerName: f.officerName || '', officerPartnerId: null,
    ownerFirstName: f.ownerFirstName || '', ownerLastName: f.ownerLastName || '', ownerPhone: f.ownerPhone || '',
    remarks, photoUrls,
    policeBlocked: !!f.policeBlocked,
    sncRequiresBalisage: !!f.sncRequiresBalisage,
    sncScenario: null, scAssistanceName: null,
    incidentLat: typeof f.lat === 'number' ? f.lat : null, incidentLng: typeof f.lng === 'number' ? f.lng : null,
    destination: f.destination || '', destinationLat: null, destinationLng: null,
    amountToCollect: type === 'appel_prive' ? (f.amountToCollect || '') : null,
    appelPriveType: type === 'appel_prive' ? (f.appelPriveType || null) : null,
    appelPriveDestination: type === 'appel_prive' ? (f.appelPriveDestination || null) : null,
    malGareeScenario: type === 'mal_garee' ? (f.malGareeScenario || 'chargement') : null,
    saisieMotifCode: type === 'saisie' ? (f.saisieMotifCode || null) : null,
    saisieMotifLabel: type === 'saisie' ? (f.saisieMotifLabel || null) : null,
    offlineId: f.id, offlineCreatedAt: fait,
  }
  const url = immediat ? '/api/missions/police/draft' : '/api/towsoft/create'
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
  if (!r) throw new Reessayer('réseau')
  const d = await json(r)
  if (r.status >= 500 || r.status === 401) throw new Reessayer(d.error || `serveur ${r.status}`)
  if (!r.ok || !d.ok || !d.missionId) throw new Refus(d.error || 'Fiche refusée par le programme : appelle le dispatch.')
  return { missionId: d.missionId, missionNumber: d.missionNumber ?? null, message: immediat ? 'À encaisser sur la fiche.' : undefined }
}

let enCours = false

/** Envoie les fiches en attente. Renvoie le nombre de fiches envoyées. */
export async function envoyerFiches(): Promise<number> {
  const p = pluginHorsLigne(); if (!p || enCours) return 0
  enCours = true
  let n = 0
  try {
    const { fiches } = await p.pending()
    const liste = (fiches || []).slice().sort((a, b) => String(a.fiche?.createdAt).localeCompare(String(b.fiche?.createdAt)))
    for (const e of liste) {
      try {
        const res = await envoyerUne(e.fiche, e.photos || [])
        await p.markSent({ id: e.id, missionId: res.missionId, missionNumber: res.missionNumber ?? null, message: res.message })
        n++
      } catch (err: any) {
        if (err instanceof Refus) {
          await p.markFailed({ id: e.id, error: err.message, final: true })
          signaler(e.fiche, err.message)
          continue
        }
        await p.markFailed({ id: e.id, error: String(err?.message || err), final: false }).catch(() => {})
        break   // réseau encore instable : on reprendra au prochain retour du réseau
      }
    }
  } catch { /* plugin indisponible */ }
  finally { enCours = false }
  return n
}

// Une fiche refusée doit se voir (dispatch / Sam) : on la note dans le journal des erreurs.
function signaler(f: FicheHorsLigne, raison: string) {
  fetch('/api/client-error', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level: 'error', where: 'fiche-hors-ligne', message: `Fiche hors ligne refusée : ${raison}`, url: location.href, context: { fiche: { ...f } } }),
  }).catch(() => {})
}
