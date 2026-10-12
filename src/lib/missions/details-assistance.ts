// src/lib/missions/details-assistance.ts
//
// Détails d'une mission CÔTÉ ASSISTANCE (Olivier 12/10/2026) : quand la fiche ne dit pas tout (mail IMA réduit à un
// lien, téléphone absent…), on va lire la source — portail IMA (lien du mail) ou plateforme Kaze — pour que Sam et
// Sonic répondent eux-mêmes au chauffeur, et pour compléter la fiche. On ne remplit QUE des champs vides : jamais
// d'écrasement de ce que Kaze, l'assistance ou le dispatch ont déjà posé.

import { createAdminClient } from '@/lib/supabase'

export interface DetailsAssistance {
  origine: 'portail IMA' | 'Kaze'
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

/** Détails d'une mission côté assistance : portail IMA (lien dans le mail) ou job Kaze. */
export async function detailsAssistance(missionId: string): Promise<DetailsAssistance | null> {
  const sb = createAdminClient()
  const { data: m } = await sb.from('incoming_missions').select('id, source, external_id, raw_content').eq('id', missionId).maybeSingle()
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
  return null
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
