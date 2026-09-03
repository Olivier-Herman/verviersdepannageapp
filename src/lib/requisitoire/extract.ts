// src/lib/requisitoire/extract.ts
//
// Extraction d'un document police (réquisitoire OU levée de saisie) via Claude.
// Les documents arrivent dans fourriere@ depuis PLUSIEURS expéditeurs (zones de
// police, parquets) → pas d'émetteur fixe : Claude lit la pièce jointe (PDF,
// souvent scanné → vision) OU le corps du mail (levée parfois sans document) pour
// (a) classer le type, (b) confirmer, (c) extraire les signaux de rapprochement
// + le n° de PV (réquisitoire) ou la date/type de levée (levée de saisie).
//
// Réutilise le pattern de [anthropic-pdf.ts] + le modèle centralisé.
// Olivier 2026-07-01. Cf [[project_assistant_mail_module]].

import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL } from '@/lib/anthropic-model'
import { parseTowsoftDateUTC } from '@/lib/towsoft-client'

export type DocType = 'requisitoire' | 'levee_saisie' | 'autre'

export interface RequisitoireExtract {
  doc_type:        DocType
  is_requisitoire: boolean          // = doc_type === 'requisitoire' (compat)
  // Identifiants véhicule (matching) — communs aux 2 types
  plaque:          string | null
  vin:             string | null
  marque:          string | null
  modele:          string | null
  adresse:         string | null
  autorite:        string | null
  // Réquisitoire
  pv_number:       string | null
  date_requisition: string | null   // YYYY-MM-DD
  heure_requisition: string | null  // HH:MM si présent
  // Levée de saisie
  levee_date:      string | null    // date effective de levée (YYYY-MM-DD)
  levee_type:      'definitive' | 'temporaire' | null
  raw_quote:       string | null
  // Formulaire + case MOTIF cochée (Olivier 2026-09-03) : la procédure de
  // facturation dépend du motif — judiciaire (saisie → Parquet) vs administratif
  // (stationnement → Mal garée, abandon voie publique → AVP).
  form_kind:       'judiciaire' | 'administratif' | null
  motif:           RequisitoireMotif | null
}

export type RequisitoireMotif =
  | 'non_assurance' | 'accident' | 'vol' | 'degrade_incendie' | 'recherche_indices' | 'patrimoniale' | 'autre_judiciaire'
  | 'stationnement' | 'accident_administratif' | 'abandon_voie_publique' | 'autre_administratif'

export const REQUISITOIRE_MOTIFS: RequisitoireMotif[] = [
  'non_assurance', 'accident', 'vol', 'degrade_incendie', 'recherche_indices', 'patrimoniale', 'autre_judiciaire',
  'stationnement', 'accident_administratif', 'abandon_voie_publique', 'autre_administratif',
]

const PROMPT = `Tu es un assistant d'une société de dépannage/fourrière en Belgique. On te fournit un document reçu par email (PDF scanné OU corps de mail). Il peut s'agir de :
- un "réquisitoire" : ordre officiel d'une zone de police / parquet demandant l'enlèvement, la saisie ou le gardiennage d'un véhicule ;
- une "levée de saisie" (mainlevée) : ordre/mail officiel indiquant que la saisie d'un véhicule est LEVÉE (le véhicule peut être restitué). Souvent un simple mail du policier, parfois avec document.
- autre chose (facture, courrier divers).

Retourne UNIQUEMENT un objet JSON (pas de markdown) avec EXACTEMENT :

{
  "doc_type": "string — 'requisitoire' | 'levee_saisie' | 'autre'",
  "plaque": "string|null — plaque d'immatriculation (format d'origine)",
  "vin": "string|null — n° de châssis / VIN complet",
  "marque": "string|null — marque du véhicule",
  "modele": "string|null — modèle du véhicule",
  "adresse": "string|null — lieu de l'enlèvement / saisie (rue + localité)",
  "autorite": "string|null — zone de police / parquet / autorité émettrice",
  "pv_number": "string|null — [réquisitoire] n° de PV / procès-verbal / notice",
  "date_requisition": "string|null — [réquisitoire] date de l'intervention/saisie YYYY-MM-DD si possible",
  "heure_requisition": "string|null — [réquisitoire] heure de l'intervention/saisie HH:MM (24h) si présente, sinon null",
  "levee_date": "string|null — [levée] date effective de la levée de saisie YYYY-MM-DD",
  "levee_type": "string|null — [levée] 'definitive' ou 'temporaire' si précisé, sinon null",
  "raw_quote": "string|null — très courte citation qui justifie (max 120 caractères)",
  "form_kind": "string|null — [réquisitoire] 'judiciaire' si l'en-tête est « RÉQUISITOIRE ENLÈVEMENT/GARDIENNAGE DE VÉHICULE » (bloc « DATE ET MOTIF DE LA SAISIE ») ; 'administratif' si l'en-tête est « RÉQUISITOIRE ADMINISTRATIF ENLÈVEMENT/GARDIENNAGE » (bloc « DATE ET MOTIF DE L'ENLÈVEMENT ») ; null si autre mise en page",
  "motif": "string|null — [réquisitoire] la case COCHÉE (☒ / X / croix) du bloc motif. Formulaire judiciaire : 'non_assurance' | 'accident' | 'vol' | 'degrade_incendie' | 'recherche_indices' | 'patrimoniale' | 'autre_judiciaire'. Formulaire administratif : 'stationnement' | 'accident_administratif' | 'abandon_voie_publique' | 'autre_administratif'. Si aucune case n'est clairement cochée ou si le texte libre ne permet pas de trancher : null"
}

RÈGLES :
- Si une info n'est pas présente, mets null (ne devine pas).
- motif : regarde UNIQUEMENT les cases du bloc « DATE ET MOTIF … ». Une case cochée est marquée d'une croix (☒, X, ✓). Ne déduis pas le motif d'autres parties du document. Formulaire Fagnes en texte libre (« Infraction de roulage » + article sur l'assurance) → 'non_assurance'.
- Si la case cochée est « Autres saisies administratives : … » et que le texte libre dit « Abandon voie publique » / « AVP » → 'abandon_voie_publique' ; s'il dit « Stationnement » → 'stationnement' ; sinon 'autre_administratif' et recopie le texte libre dans raw_quote.
- Plaque belge : "1-ABC-234" ou "1ABC234". VIN = 17 caractères alphanumériques.
- Ne confonds pas pv_number avec la plaque ou le VIN.

CLASSIFICATION (doc_type) — PRIORITÉ À LA LEVÉE :
- 'levee_saisie' si le document/mail indique que la saisie est LEVÉE, qu'il y a
  MAINLEVÉE, que le véhicule peut être RESTITUÉ / LIBÉRÉ / RÉCUPÉRÉ / RENDU, que
  la saisie ou le blocage PREND FIN, ou qu'une restitution est AUTORISÉE. IMPORTANT :
  même si le mot « saisie » apparaît, si l'OBJET du document est de LEVER / METTRE
  FIN à la saisie → c'est 'levee_saisie'.
  Indices : "mainlevée", "levée de la saisie", "la saisie est levée", "fin de
  saisie", "restitution autorisée", "peut être restitué", "véhicule à restituer",
  "libéré", "vous pouvez restituer/récupérer".
- 'requisitoire' si le document ORDONNE l'enlèvement / la saisie / la mise en
  fourrière / le gardiennage (MISE EN PLACE de la saisie).
- 'autre' uniquement si ce n'est NI un réquisitoire NI une levée (facture, courrier divers).
Retourne UNIQUEMENT le JSON.`

/**
 * Construit le timestamp d'intervention (ISO) depuis la date + heure du
 * réquisitoire (heure locale BE +02:00). Défaut 09:00 si pas d'heure lue.
 * Renvoie null si la date n'est pas exploitable.
 */
export function requisitoireIncidentAt(ex: Pick<RequisitoireExtract, 'date_requisition' | 'heure_requisition'>): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ex.date_requisition || '')) return null
  const time = /^\d{1,2}:\d{2}$/.test(ex.heure_requisition || '') ? (ex.heure_requisition as string).padStart(5, '0') : '09:00'
  // Date/heure du document = heure LOCALE Belgique → conversion UTC via Europe/Brussels.
  return parseTowsoftDateUTC(`${ex.date_requisition}T${time}:00`)
}

/**
 * Immatriculation PROVISOIRE (« à compléter ») quand aucune plaque n'est connue :
 * marque + 5 derniers caractères du châssis (VIN). Ex : "VOLKSWAGEN 3KS12".
 * Renvoie null s'il n'y a pas de quoi construire (ni marque ni VIN exploitable).
 */
export function provisionalPlate(brand: string | null, vin: string | null): string | null {
  const b = (brand || '').trim().toUpperCase()
  const v = (vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const last5 = v.length >= 5 ? v.slice(-5) : v
  if (!last5 && !b) return null
  if (!last5) return null   // sans VIN exploitable, pas d'identifiant fiable
  return `${b}${b ? ' ' : ''}${last5}`.trim()
}

let cachedClient: Anthropic | null = null
function getClient(): Anthropic {
  if (cachedClient) return cachedClient
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquant en env vars')
  cachedClient = new Anthropic({ apiKey })
  return cachedClient
}

function coerce(item: any): RequisitoireExtract {
  const s = (v: any) => (v == null || v === '' ? null : String(v).trim())
  const dt: DocType = ['requisitoire', 'levee_saisie', 'autre'].includes(item?.doc_type) ? item.doc_type : 'autre'
  const lt = ['definitive', 'temporaire'].includes(item?.levee_type) ? item.levee_type : null
  return {
    doc_type:        dt,
    is_requisitoire: dt === 'requisitoire',
    plaque:          s(item?.plaque),
    vin:             s(item?.vin),
    marque:          s(item?.marque),
    modele:          s(item?.modele),
    adresse:         s(item?.adresse),
    autorite:        s(item?.autorite),
    pv_number:       s(item?.pv_number),
    date_requisition: s(item?.date_requisition),
    heure_requisition: s(item?.heure_requisition),
    levee_date:      s(item?.levee_date),
    levee_type:      lt as any,
    raw_quote:       s(item?.raw_quote)?.slice(0, 120) ?? null,
    form_kind:       ['judiciaire', 'administratif'].includes(item?.form_kind) ? item.form_kind : null,
    motif:           REQUISITOIRE_MOTIFS.includes(item?.motif) ? item.motif : null,
  }
}

function parseJson(text: string): any {
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
  try { return JSON.parse(cleaned) } catch {
    const start = cleaned.indexOf('{')
    const end   = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1))
    throw new Error(`JSON Claude invalide : ${text.slice(0, 200)}`)
  }
}

/** Extrait depuis un PDF (base64). */
export async function extractRequisitoireFromPdf(pdfBase64: string): Promise<RequisitoireExtract> {
  const client = getClient()
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: PROMPT },
      ],
    }],
  })
  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') throw new Error('Aucun texte retourné par Claude')
  return coerce(parseJson(textBlock.text))
}

/** Extrait depuis une IMAGE (base64) — un scan qui n'est pas rendu en PDF. */
export async function extractRequisitoireFromImage(imageBase64: string, mediaType: string): Promise<RequisitoireExtract> {
  const client = getClient()
  const media = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mediaType) ? mediaType : 'image/jpeg'
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: media as any, data: imageBase64 } },
        { type: 'text', text: PROMPT },
      ],
    }],
  })
  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') throw new Error('Aucun texte retourné par Claude')
  return coerce(parseJson(textBlock.text))
}

/** Extrait depuis un texte (corps du mail — levée sans document). */
export async function extractRequisitoireFromText(text: string): Promise<RequisitoireExtract> {
  const client = getClient()
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: `${PROMPT}\n\n--- DOCUMENT (texte du mail) ---\n\n${text.slice(0, 12000)}` }],
  })
  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') throw new Error('Aucun texte retourné par Claude')
  return coerce(parseJson(textBlock.text))
}
