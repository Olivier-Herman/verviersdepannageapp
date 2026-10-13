// src/lib/missions/details-assistance.ts
//
// Détails d'une mission CÔTÉ ASSISTANCE (Olivier 12/10/2026) : quand la fiche ne dit pas tout (mail IMA réduit à un
// lien, téléphone absent…), on va lire la source — portail IMA (lien du mail) ou plateforme Kaze — pour que Sam et
// Sonic répondent eux-mêmes au chauffeur, et pour compléter la fiche. On ne remplit QUE des champs vides : jamais
// d'écrasement de ce que Kaze, l'assistance ou le dispatch ont déjà posé.

import { createAdminClient } from '@/lib/supabase'

export interface DetailsAssistance {
  origine: 'portail IMA' | 'Kaze' | 'VAB' | 'Touring (COMEX)' | 'AXA' | 'Allianz'
  contact: string | null
  telephone: string | null
  lieu: string | null
  livraison: string | null
  panne: string | null
  commentaire: string | null
  vehicule: string | null
  /** Texte brut utile (tronqué) : pour répondre à une question imprévue. */
  texte: string
}

const LIBELLES_IMA = ['Contact sur place', 'Identification', 'Particularités', 'Commentaire', "Statut de l'affaire", 'Détail de la mission',
  'Données identification', 'N° de Commande', 'Propriétaire', 'Lieu intervention', 'Lieu livraison', 'Motif', 'Prédiagnostic', 'Effet Client',
  'Données véhicule', 'Type', 'Energie', 'Marque', 'Modèle', 'Immatriculation', 'Données de facturation', 'Entité à facturer', 'Tel. livraison']
// Titres de section sans « : » qui suivent un champ dans la page.
const SECTIONS_IMA = [' Données de facturation', ' Données véhicule', ' Données identification', ' Détail de la mission', ' Mentions légales']

const nettoie = (s: string | null | undefined) => {
  const v = String(s || '').replace(/\s+/g, ' ').trim().replace(/\bBELGIQUE\b/i, '').trim()
  return v && !/^[-–.]*$/.test(v) ? v : null
}
const TEL = /(\+?\d[\d\s./()-]{7,}\d)\s*$/

/** Lit la page « Ordre d'intervention » du portail IMA (lien du mail) ; null si inaccessible. */
export async function lirePortailIma(url: string): Promise<DetailsAssistance | null> {
  try {
    const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12_000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VerviersDepannage/1.0)', 'Accept-Language': 'fr-BE,fr;q=0.9' } })
    if (!r.ok) return null
    const html = await r.text()
    const texte = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ').trim()
    if (!/Ordre d'intervention|N° de Commande|Lieu intervention/i.test(texte)) return null   // page de connexion ou d'erreur
    const champ = (lib: string) => {
      const i = texte.indexOf(`${lib} :`)
      if (i < 0) return null
      const reste = texte.slice(i + lib.length + 2)
      let fin = reste.length
      for (const autre of LIBELLES_IMA) { if (autre === lib) continue; const j = reste.indexOf(`${autre} :`); if (j >= 0 && j < fin) fin = j }
      for (const sec of SECTIONS_IMA) { const j = reste.indexOf(sec); if (j >= 0 && j < fin) fin = j }
      return nettoie(reste.slice(0, Math.min(fin, 220)))
    }
    const contactBrut = champ('Contact sur place') || champ('Propriétaire')
    const tel = contactBrut?.match(TEL)?.[1]?.replace(/[\s./()-]/g, '') || null
    const panne = [champ('Motif'), champ('Prédiagnostic')].filter(Boolean).join(' — ') || null
    return {
      origine: 'portail IMA',
      contact: contactBrut ? nettoie(contactBrut.replace(TEL, '')) : null,
      telephone: tel,
      lieu: champ('Lieu intervention'),
      livraison: [champ('Lieu livraison'), champ('Tel. livraison') ? `tél. ${champ('Tel. livraison')}` : null].filter(Boolean).join(' — ') || null,
      panne,
      commentaire: champ('Commentaire'),
      vehicule: [champ('Marque'), champ('Modèle'), champ('Immatriculation')].filter(Boolean).join(' ') || null,
      texte: texte.slice(Math.max(0, texte.indexOf('Ordre d')), Math.max(0, texte.indexOf('Ordre d')) + 1500),
    }
  } catch { return null }
}

/** Détails d'une mission côté assistance : portail IMA (lien du mail), Kaze, VAB, Touring (COMEX), AXA, Allianz.
 *  On teste l'IDENTIFIANT propre à chaque assistance, pas la source : une mission non couverte reclassée Siabis
 *  garde son lien avec l'assistance (Olivier 13/10/2026 : « étends ça à toutes les assistances »). */
export async function detailsAssistance(missionId: string): Promise<DetailsAssistance | null> {
  const sb = createAdminClient()
  const { data: m } = await sb.from('incoming_missions').select('id, source, source_format, external_id, raw_content, dossier_number, vab_assignment_ids, axa_mission_order_id').eq('id', missionId).maybeSingle()
  if (!m) return null
  const lien = String(m.raw_content || '').match(/https:\/\/imamobile\.ima\.eu\/[^\s"<>]+/)?.[0]
  if (lien) {
    const d = await lirePortailIma(lien)
    if (d) return d
  }
  if (m.source === 'kaze' && m.external_id && /^[0-9a-f-]{30,}$/i.test(m.external_id)) {
    try {
      const { getJob } = await import('@/lib/kaze/client')
      const { mapKazeJobToMission } = await import('@/lib/kaze/mapper')
      const k = mapKazeJobToMission(await getJob(m.external_id))
      return {
        origine: 'Kaze', contact: k.client_name, telephone: k.client_phone || k.client_phone2,
        lieu: k.incident_address, livraison: [k.destination_name, k.destination_address].filter(Boolean).join(', ') || null,
        panne: k.incident_description || k.incident_type, commentaire: null,
        vehicule: [k.vehicle_brand, k.vehicle_model, k.vehicle_plate].filter(Boolean).join(' ') || null,
        texte: JSON.stringify(k).slice(0, 1500),
      }
    } catch { return null }
  }
  return (await lireVab(m)) || (await lireComex(m)) || (await lireAxa(m)) || (await lireAllianz(m))
}

const adr = (...p: (string | null | undefined)[]) => p.map(x => String(x || '').trim()).filter(Boolean).join(', ') || null
const court = (o: any) => JSON.stringify(o ?? {}).slice(0, 1500)

/** VAB : AssignmentId dans external_id ou vab_assignment_ids ; session du connecteur. */
async function lireVab(m: any): Promise<DetailsAssistance | null> {
  const ids: string[] = Array.isArray(m.vab_assignment_ids) ? m.vab_assignment_ids : []
  if (String(m.source).toLowerCase() !== 'vab' && m.source_format !== 'vab-scraper' && !ids.length) return null
  const aid = String(m.external_id || '').match(/\d+/)?.[0] || ids[0]
  if (!aid) return null
  try {
    const { loginVab, vabDetailUrl, fetchVabMissionDetail } = await import('@/lib/vab/scraper')
    const sess = await loginVab()
    const d: any = await fetchVabMissionDetail(sess, await vabDetailUrl(sess, aid), aid)
    if (!d || 'error' in d) return null
    return {
      origine: 'VAB', contact: d.clientName || d.fromName || null, telephone: d.clientPhone || d.fromPhone || null,
      lieu: [adr(d.fromStreet, [d.fromZip, d.fromCity].filter(Boolean).join(' ')), d.fromLocationFreeText].filter(Boolean).join(' — ') || null,
      livraison: [adr(d.toName, d.toStreet, [d.toZip, d.toCity].filter(Boolean).join(' ')), d.toPhone ? `tél. ${d.toPhone}` : null].filter(Boolean).join(' — ') || null,
      panne: d.codesDePanne || d.taskType || null, commentaire: d.descriptionText || null,
      vehicule: [d.vehicleBrand, d.vehicleModel, d.vehiclePlate].filter(Boolean).join(' ') || null,
      texte: String(d.rawSnippet || '').slice(0, 1500),
    }
  } catch { return null }
}

/** Touring : clés COMEX (CID_DOS / CID_SEQ_ACTION) dans le contenu brut d'une fiche COMEX. */
async function lireComex(m: any): Promise<DetailsAssistance | null> {
  try {
    const { comexKeysOf } = await import('@/lib/touring/sync')
    const keys = comexKeysOf(m)
    if (!keys) return null
    const { loginComex, getComexMissionDetail } = await import('@/lib/touring/comex')
    const { mapComexToMission } = await import('@/lib/touring/map-mission')
    const r = await getComexMissionDetail(await loginComex('dispatch'), keys)
    const d = r?.content || r || {}
    const k = mapComexToMission({ detail: d, status: 'new' } as any)
    return {
      origine: 'Touring (COMEX)', contact: k.client_name || k.assisted_name || null, telephone: k.client_phone || null,
      lieu: k.incident_address || null, livraison: adr(k.destination_name, k.destination_address),
      panne: k.incident_description || k.incident_type || null,
      commentaire: d.DESCR_SIN && d.DESCR_SIN !== k.incident_description ? String(d.DESCR_SIN) : null,
      vehicule: [k.vehicle_brand, k.vehicle_model, k.vehicle_plate].filter(Boolean).join(' ') || null,
      texte: court(d),
    }
  } catch { return null }
}

/** AXA go&assist : axa_mission_order_id (repli external_id seulement pour une fiche AXA). */
async function lireAxa(m: any): Promise<DetailsAssistance | null> {
  try {
    const { axaMissionOrderId } = await import('@/lib/axa/close-bg')
    const id = axaMissionOrderId(m.axa_mission_order_id || (m.source === 'axa' ? m.external_id : null))
    if (!id) return null
    const { getMission } = await import('@/lib/axa/goassist')
    const d = await getMission(id)
    if (!d) return null
    const dc = d.case || {}
    const a = dc.incidentLocation?.address || {}
    const dest = dc.service?.serviceDestination || null
    const ct = (d.contacts || []).find((c: any) => c?.firstName || c?.lastName) || {}
    const v = d.vehicle || dc.vehicle || {}
    return {
      origine: 'AXA', contact: [ct.firstName, ct.lastName].filter(Boolean).join(' ') || null, telephone: ct.phoneNumber || null,
      lieu: adr(a.streetAddress, [a.postalCode, a.locality].filter(Boolean).join(' ')),
      livraison: adr(dest?.name, dest?.address?.streetAddress, [dest?.address?.postalCode, dest?.address?.locality].filter(Boolean).join(' ')),
      panne: dc.problemContext?.problemDescription || dc.problemContext?.problemCode || dc.service?.serviceCode || null,
      commentaire: null,
      vehicule: [v.brand, v.model, dc.registrationPlateNumber].filter(Boolean).join(' ') || null,
      texte: court(d),
    }
  } catch { return null }
}

/** Allianz / Hexalite (Mondial) : n° d'affectation ; lecture seulement si un jeton valide existe (jamais d'OTP ici). */
async function lireAllianz(m: any): Promise<DetailsAssistance | null> {
  if (!['mondial', 'allianz'].includes(String(m.source || '').toLowerCase()) && !/allianzpartners/i.test(String(m.raw_content || ''))) return null
  try {
    const num = String(m.dossier_number || m.external_id || '').split('/')[0].trim()
    const { fetchAllianzAssignmentByNumber, mapAllianzAssignment, parseAllianzDispatchLink } = await import('@/lib/allianz/intake')
    let aid: string | null = num ? (await fetchAllianzAssignmentByNumber(num).catch(() => null))?.assignmentId || null : null
    if (!aid) {
      const { data: p } = await createAdminClient().from('allianz_otp_pending').select('assignment_id, dispatch_link').eq('mission_id', m.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
      aid = p?.assignment_id || parseAllianzDispatchLink(p?.dispatch_link).assignmentId || null
    }
    if (!aid) return null
    const { getValidAllianzToken } = await import('@/lib/allianz/closure')
    const { allianzFetchMissionData, allianzExtractMissionData } = await import('@/lib/missions/allianz')
    const r = await allianzFetchMissionData(await getValidAllianzToken(), aid)
    if (!r) return null
    const x = allianzExtractMissionData(r.jobData, r.caseData)
    const f = mapAllianzAssignment(r.jobData).fields as any
    return {
      origine: 'Allianz', contact: x.client_name || null, telephone: x.client_phone || null,
      lieu: f.incident_address || x.incident_address || null, livraison: f.destination_address || null,
      panne: x.incident_type || null, commentaire: x.incident_description || f.remarks_general || null,
      vehicule: [f.vehicle_brand, f.vehicle_model, f.vehicle_plate].filter(Boolean).join(' ') || null,
      texte: court({ job: r.jobData, dossier: r.caseData }),
    }
  } catch { return null }
}

/** Complète les champs VIDES de la fiche avec les détails de l'assistance. Renvoie la liste des champs complétés. */
export async function completerFiche(missionId: string, d: DetailsAssistance): Promise<string[]> {
  const sb = createAdminClient()
  const { data: m } = await sb.from('incoming_missions')
    .select('id, client_name, client_phone, assisted_name, assisted_phone, incident_address, destination_address, incident_description, remarks_general')
    .eq('id', missionId).maybeSingle()
  if (!m) return []
  const upd: Record<string, any> = {}
  if (d.telephone && !m.assisted_phone) { upd.assisted_phone = d.telephone; if (d.contact && !m.assisted_name) upd.assisted_name = d.contact }
  if (d.telephone && !m.client_phone) { upd.client_phone = d.telephone; if (d.contact && !m.client_name) upd.client_name = d.contact }
  // Adresses sans position : le bureau la confirme dans les suggestions (géocodage dans le navigateur).
  if (d.lieu && !m.incident_address) upd.incident_address = d.lieu
  if (d.livraison && !m.destination_address) upd.destination_address = d.livraison
  if (d.panne && !m.incident_description) upd.incident_description = d.panne
  const remarque = d.commentaire ? `Commentaire de l’assistance (${d.origine}) : ${d.commentaire}` : null
  if (remarque && !String(m.remarks_general || '').includes(d.commentaire!)) upd.remarks_general = [m.remarks_general, remarque].filter(Boolean).join('\n')
  const champs = Object.keys(upd)
  if (!champs.length) return []
  await sb.from('incoming_missions').update({ ...upd, updated_at: new Date().toISOString() }).eq('id', missionId)
  await sb.from('mission_logs').insert({ mission_id: missionId, action: 'enrichissement', notes: `Fiche complétée depuis ${d.origine} : ${champs.join(', ')}.` }).then(() => {}, () => {})
  return champs
}
