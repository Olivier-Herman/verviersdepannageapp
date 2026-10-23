// src/lib/vab/vr-contrat.ts — contrat « véhicule de remplacement » VAB (Olivier 23/10/2026).
//
// Le chauffeur affiche un QR (/vr/<id>) ; le client photographie sa carte d'identité et son permis
// (recto + verso), vérifie ce qui a été lu, donne son adresse (recherche Google découpée dans l'ordre
// de Comet : pays, code postal/ville, rue, n°, boîte) et signe sur son téléphone. Pendant ce temps,
// le chauffeur note l'état du véhicule prêté. Tout reste dans VD Soft ; le bureau recopie dans Comet
// (onglet « Client » de l'assistant de document) tant que l'encodage automatique n'existe pas.
// Maquette validée : https://claude.ai/artifact/1VLFohCUhrUgshm43vPEJo

export const VR_BUCKET = 'mission-documents'
export const VR_TTL_MIN = 120

export const VR_PHOTOS = ['id_recto', 'id_verso', 'permis_recto', 'permis_verso'] as const
export type VrPhoto = typeof VR_PHOTOS[number]

export const PROPRETES = ['propre', 'correct', 'sale'] as const
export const CARBURANTS = [0, 25, 50, 75, 100] as const

export interface VrAdresse { pays: string; cp: string; ville: string; rue: string; numero: string; boite: string }
export interface VrClient {
  nom: string; prenom: string; naissance: string; carte_id: string; permis: string
  email: string; tel: string; langue: string; adresse: VrAdresse
}
export interface VrVehicule { proprete_int?: string | null; proprete_ext?: string | null; km?: number | null; carburant?: number | null }

export const ADRESSE_VIDE: VrAdresse = { pays: 'BE', cp: '', ville: '', rue: '', numero: '', boite: '' }
export const CLIENT_VIDE: VrClient = { nom: '', prenom: '', naissance: '', carte_id: '', permis: '', email: '', tel: '', langue: 'fr', adresse: ADRESSE_VIDE }

export const PAYS: Record<string, string> = { BE: 'Belgique', NL: 'Pays-Bas', LU: 'Luxembourg', FR: 'France', DE: 'Allemagne' }

export function clientRempli(c: Partial<VrClient> | null | undefined): boolean {
  const a = c?.adresse
  return !!(c?.nom && c?.prenom && c?.naissance && c?.carte_id && c?.permis && a?.cp && a?.ville && a?.rue && a?.numero)
}
export function vehiculeRempli(v: VrVehicule | null | undefined): boolean {
  return !!(v?.proprete_int && v?.proprete_ext && v?.km != null && v.km > 0 && v?.carburant != null)
}

/** Ce que voit le chauffeur (et le bureau) : avancement en 4 temps. */
export function avancement(row: any) {
  const photos = VR_PHOTOS.filter(k => row?.photos?.[k]).length
  return {
    photos,
    infos: clientRempli(row?.client) && row?.status !== 'ouvert',
    signe: !!row?.signed_at,
    vehicule: vehiculeRempli(row?.vehicule),
  }
}

/** Fusionne la lecture des documents dans la fiche client sans écraser ce qui est déjà saisi. */
export function preRemplir(client: Partial<VrClient>, ocr: any): VrClient {
  const c: VrClient = { ...CLIENT_VIDE, ...client, adresse: { ...ADRESSE_VIDE, ...(client.adresse || {}) } }
  const id = ocr?.id || {}, pe = ocr?.permis || {}
  const put = (k: keyof VrClient, v: any) => { if (!c[k] && v) (c as any)[k] = String(v).trim() }
  put('nom', id.lastName || pe.lastName)
  put('prenom', id.firstName || pe.firstName)
  put('naissance', id.birthDate || pe.birthDate)
  put('carte_id', id.documentNumber)
  put('permis', pe.licenceNumber)
  return c
}

export const PERMIS_PROMPT = `Tu lis un permis de conduire (modèle européen carte bancaire, tous pays) à partir de photos du recto et du verso. Les rubriques sont numérotées : 1 nom, 2 prénoms, 3 date et lieu de naissance, 4a date de délivrance, 4b date d'expiration, 4c autorité, 5 numéro du permis, 9 catégories.

Retourne UNIQUEMENT un JSON strict, sans markdown ni commentaire :
{
  "lastName": <string|null>,       // rubrique 1, casse normale ("DUPONT" → "Dupont")
  "firstName": <string|null>,      // rubrique 2
  "birthDate": <string|null>,      // JJ/MM/AAAA
  "licenceNumber": <string|null>,  // rubrique 5, tel qu'imprimé
  "issued": <string|null>,         // 4a JJ/MM/AAAA
  "expiry": <string|null>,         // 4b JJ/MM/AAAA
  "country": <string|null>,        // pays émetteur en toutes lettres
  "categories": <string|null>,     // ex. "AM, B"
  "confidence": "high"|"medium"|"low"
}

Si ce n'est pas un permis de conduire ou si c'est illisible, confidence="low" et champs à null. N'invente rien.`

/** Texte prêt à recopier dans Comet, dans l'ordre des champs de l'onglet « Client ». */
export function lignesComet(c: Partial<VrClient> | null | undefined): [string, string][] {
  const a = { ...ADRESSE_VIDE, ...(c?.adresse || {}) }
  const langue: Record<string, string> = { fr: 'Français', nl: 'Néerlandais', en: 'Anglais', de: 'Allemand' }
  return [
    ['Nom', c?.nom || ''], ['Prénom', c?.prenom || ''], ['Langue', langue[c?.langue || ''] || c?.langue || ''],
    ['E-mail', c?.email || ''], ['Téléphone', c?.tel || ''], ['Date de naissance', c?.naissance || ''],
    ['N° permis de conduire', c?.permis || ''], ['N° carte d’identité', c?.carte_id || ''],
    ['Pays', PAYS[a.pays] || a.pays], ['Code postal / ville', [a.cp, a.ville].filter(Boolean).join(' ')],
    ['Rue', a.rue], ['N° de maison', a.numero], ['Boîte', a.boite],
  ]
}

/**
 * Client signé + état du véhicule noté → contrat complet : trace dans l'historique et prévient le bureau,
 * qui recopie dans Comet (onglet « Client ») tant que l'encodage automatique n'existe pas.
 */
export async function finaliserSiComplet(sb: any, id: string): Promise<void> {
  const { data: r } = await sb.from('vr_contrats').select('id, mission_id, status, client, vehicule, signed_at').eq('id', id).maybeSingle()
  if (!r || r.status === 'complet' || !r.signed_at || !clientRempli(r.client) || !vehiculeRempli(r.vehicule)) return
  const now = new Date().toISOString()
  const { data: upd } = await sb.from('vr_contrats').update({ status: 'complet', completed_at: now, comet_status: 'a_encoder', updated_at: now })
    .eq('id', id).neq('status', 'complet').select('id')
  if (!upd?.length) return
  const { data: m } = await sb.from('incoming_missions').select('id, mission_number, vab_vr').eq('id', r.mission_id).maybeSingle()
  const plaque = m?.vab_vr?.plate || ''
  await sb.from('mission_logs').insert({
    mission_id: r.mission_id, action: 'vab_vr_contrat_complet',
    notes: `Contrat du véhicule de remplacement ${plaque} complet : ${r.client.prenom} ${r.client.nom}, signé ; état du véhicule noté (${r.vehicule.km} km, carburant ${r.vehicule.carburant} %). À encoder dans Comet.`.replace(/\s+/g, ' '),
    metadata: { contrat: id, auto: true },
  }).then(() => {}, () => {})
  try {
    const { sendPushToRole } = await import('@/lib/push')
    await sendPushToRole(['dispatcher', 'admin', 'superadmin'], {
      title: '🚗 Contrat VR VAB à encoder dans Comet',
      body: `Mission #${m?.mission_number ?? ''} ${plaque} : client, signature et état du véhicule complets. Les données sont dans la fiche.`.replace(/\s+/g, ' '),
      url: `/dispatch/${r.mission_id}`,
    })
  } catch { /* la notification est un plus */ }
}
