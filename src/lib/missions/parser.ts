// src/lib/missions/parser.ts
// Envoie le contenu extrait à Claude API et retourne les données normalisées

import type { MissionSource, MissionType } from '@/types'
import type { ExtractedContent }           from './extractor'

export interface ParsedMission {
  external_id:          string
  dossier_number:       string | null
  mission_type:         MissionType | null
  incident_type:        string | null
  incident_description: string | null
  client_name:          string | null
  client_phone:         string | null
  client_address:       string | null
  vehicle_plate:        string | null
  vehicle_brand:        string | null
  vehicle_model:        string | null
  vehicle_vin:          string | null
  vehicle_fuel:         string | null
  vehicle_gearbox:      string | null
  incident_address:     string | null
  incident_city:        string | null
  incident_country:     string
  destination_name:     string | null
  destination_address:  string | null
  amount_guaranteed:    number | null
  incident_at:          string | null
  confidence:           number
}

// ── Hints par source pour orienter Claude ─────────────────────────────────────

const SOURCE_HINTS: Record<MissionSource, string> = {
  touring: `SOURCE: Touring Belgium (texte issu d'un RTF pipe-délimité).
RÈGLES D'EXTRACTION:
- external_id = N° Commande (format 2026189648MA)
- dossier_number = N° Dossier (format 2026BE132588)
- mission_type: "Remorquage" → remorquage | "Depannage" → depannage
- Adresse "De" = incident_address + incident_city
- Adresse "A" = destination_name + destination_address
- client_name = valeur du champ Membre (nom propre, ignorer les noms de société)
- vehicle_plate, vehicle_brand, vehicle_model dans le bloc Véhicule (format "plaque\nmarque\nmodèle")
- vehicle_vin = champ Châssis
- incident_at = date de l'incident format "JJ-MM-AAAA HH:MM:SS" → ISO 8601`,

  ethias: `SOURCE: ETHIAS via IMA Benelux (email texte plain).
RÈGLES D'EXTRACTION:
- external_id = Numéro d'intervention (format B61132149AA — conserver le AA final)
- dossier_number = même valeur que external_id
- mission_type: "Panne" → depannage | "Accident" → remorquage
- incident_type = champ "Diagnostic"
- client_name = champ "Contact sur place"
- client_phone = champ "Tel."
- vehicle_plate = champ "Plaque"
- vehicle_brand + vehicle_model = champ "Véhicule, modèle" (format MARQUE - MODELE)
- Colonne gauche "Lieu de l'incident" = incident_address + incident_city
- Colonne droite = destination_name + destination_address
- incident_at = "Le : JJ.MM.AAAA à : HHhMM" → ISO 8601`,

  vivium: `SOURCE: Vivium/P&V via IMA Benelux. Format identique à ETHIAS.
RÈGLES D'EXTRACTION: identiques à ETHIAS.
- external_id = Numéro d'intervention (format B61131891AA)`,

  axa: `SOURCE: AXA Belgium via Inter Partner Assistance (email texte plain).
RÈGLES D'EXTRACTION:
- external_id = N° Mission (ex: 09755179)
- dossier_number = N° Dossier (ex: 0126520534)
- mission_type: "Dépannage sur place" → depannage | "Transport" → remorquage | "Repair on spot" → depannage
- incident_type = champ "Type incident" (code anglais) traduit en français court
- client_name = "Nom" sous ASSISTÉ(E)
- client_phone = "Téléphone" sous ASSISTÉ(E)
- vehicle_plate = "Immatriculation"
- vehicle_brand = "Marque", vehicle_model = "Modèle"
- vehicle_fuel = "Carburant", vehicle_gearbox = "Type de boîte de vitesse"
- "Lieu de survenance" = incident_address + incident_city + incident_country
- "Lieu de livraison" = destination_address`,

  ardenne: `SOURCE: L'Ardenne Prévoyante via Inter Partner Assistance. Format identique à AXA.
RÈGLES D'EXTRACTION: identiques à AXA.`,

  mondial: `SOURCE: Mondial Assistance / Allianz Partners (document PDF).
RÈGLES D'EXTRACTION:
- external_id = No de Mission (ex: 39260713724101)
- dossier_number = No de Dossier sans espaces (ex: "2026 01165233" → "202601165233")
- mission_type depuis le Sujet: "trajet à vide" → trajet_vide | "transport" → transport | autre → remorquage
- client_name = "Nom du client"
- client_phone = "Mobile" sous Détails du client
- client_address = adresse domicile du client
- vehicle_plate = "Plaque d'immatriculation"
- vehicle_brand = "Marque", vehicle_model = "Modèle", vehicle_vin = "NIV"
- vehicle_fuel = "Type de carburant", vehicle_gearbox = "Boîte de vitesses"
- "Rue/N° + Ville/Code postal + Pays" sous "Lieu de l'assistance" = incident_address + incident_city + incident_country
- "Garage de destination" = destination_name + destination_address
- amount_guaranteed = montant numérique seul (sans "EUR" ni "TVA")
- incident_at = "Date de l'incident : JJ/MM/AAAA HH:MM" → ISO 8601`,

  vab: `SOURCE: VAB Belgium (texte issu d'un DOCX).
RÈGLES D'EXTRACTION:
- external_id = 2ème partie du N° dossier VAB (format "X/Y" → prendre Y, ex: "8244988/34267313" → "34267313")
- dossier_number = N° dossier VAB complet (format "X/Y")
- mission_type depuis le sujet ou titre: "Pechverhelping"/"Pechverhelping_VAB" → depannage | "sleep"/"REMORQUAGE"/"sleep_vab" → remorquage
- incident_address = bloc "LIEU D'IMMOBILISATION" (adresse + localité)
- incident_city = ville du lieu d'immobilisation
- "Problème selon le client" + "Information additionnelle" = incident_description
- client_name = "Nom" sous DONNÉES DU CLIENT
- client_phone = "Tél." sous DONNÉES DU CLIENT
- vehicle_plate = "Plaque"
- vehicle_brand + vehicle_model = "Marque & type" (format MARQUE MODELE)
- incident_at = "Heure de la commande: JJ/MM/AAAA HH:MM:SS" → ISO 8601`,

  unknown: `SOURCE inconnue. Extraire le maximum d'informations disponibles.`
}

const SYSTEM_PROMPT = `Tu es un extracteur précis de données de missions d'assistance routière belge.
Tu retournes UNIQUEMENT du JSON valide, sans markdown, sans backtick, sans commentaire, sans aucun texte avant ou après le JSON.
Si une information est absente, mets null. Ne devine jamais. Sois fidèle au contenu source.`

function buildUserPrompt(hint: string, subject: string): string {
  return `${hint}

Sujet email: "${subject}"

Extrais les données de cette mission et retourne ce JSON (null si absent):
{
  "external_id": "identifiant unique selon les règles source",
  "dossier_number": "numéro dossier parent, null si identique à external_id",
  "mission_type": "remorquage|depannage|transport|trajet_vide|reparation_place|autre",
  "incident_type": "type de panne court en français (ex: pneu crevé, batterie plate, accident, moteur)",
  "incident_description": "description complète de l'incident et contexte",
  "client_name": "prénom et nom complet du client/assuré",
  "client_phone": "téléphone avec indicatif pays (ex: +32477123456)",
  "client_address": "adresse domicile du client",
  "vehicle_plate": "plaque sans espaces en majuscules",
  "vehicle_brand": "marque en majuscules",
  "vehicle_model": "modèle",
  "vehicle_vin": "numéro châssis/VIN",
  "vehicle_fuel": "Diesel|Essence|Hybride|Électrique|GPL",
  "vehicle_gearbox": "Manuelle|Automatique|Semi-automatique",
  "incident_address": "rue et numéro du lieu d'incident",
  "incident_city": "ville du lieu d'incident",
  "incident_country": "code ISO 2 lettres (BE par défaut)",
  "destination_name": "nom du garage ou lieu de destination",
  "destination_address": "adresse complète de destination",
  "amount_guaranteed": null,
  "incident_at": "ISO 8601 UTC datetime ou null",
  "confidence": 0.9
}

CONTENU:`
}

function normalizeMissionType(raw: string | null): MissionType | null {
  if (!raw) return null
  const r = raw.toLowerCase()
  if (r.includes('remor') || r.includes('sleep'))      return 'remorquage'
  if (r.includes('depann') || r.includes('dépann') ||
      r.includes('place')  || r.includes('pech'))       return 'depannage'
  if (r.includes('trajet') || r.includes('vide'))       return 'trajet_vide'
  if (r.includes('transport'))                          return 'transport'
  if (r.includes('reparation') || r.includes('répar'))  return 'reparation_place'
  return 'autre'
}

export async function parseMissionContent(
  source:       MissionSource,
  content:      ExtractedContent,
  emailSubject: string = ''
): Promise<ParsedMission> {
  const hint       = SOURCE_HINTS[source] || SOURCE_HINTS.unknown
  const userPrompt = buildUserPrompt(hint, emailSubject)

  let messages: Array<{ role: string; content: unknown }>

  if (content.pdfBase64) {
    // Mondial : PDF envoyé comme document natif
    messages = [{
      role:    'user',
      content: [
        {
          type:   'document',
          source: { type: 'base64', media_type: 'application/pdf', data: content.pdfBase64 }
        },
        { type: 'text', text: userPrompt }
      ]
    }]
  } else {
    messages = [{
      role:    'user',
      content: `${userPrompt}\n${content.textContent}`
    }]
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system:     SYSTEM_PROMPT,
      messages
    })
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Claude API ${res.status}: ${err.slice(0, 200)}`)
  }

  const data    = await res.json()
  const rawText = (data.content?.[0]?.text as string) || '{}'
  const clean   = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(clean)
  } catch {
    throw new Error(`JSON invalide dans la réponse Claude: ${rawText.slice(0, 200)}`)
  }

  const externalId = (parsed.external_id as string)?.trim() || `UNKNOWN_${Date.now()}`

  return {
    external_id:          externalId,
    dossier_number:       (parsed.dossier_number       as string | null) || null,
    mission_type:         normalizeMissionType(parsed.mission_type as string | null),
    incident_type:        (parsed.incident_type        as string | null) || null,
    incident_description: (parsed.incident_description as string | null) || null,
    client_name:          (parsed.client_name          as string | null) || null,
    client_phone:         (parsed.client_phone         as string | null) || null,
    client_address:       (parsed.client_address       as string | null) || null,
    vehicle_plate:        ((parsed.vehicle_plate as string | null) || null)?.toUpperCase().replace(/\s/g, '') || null,
    vehicle_brand:        (parsed.vehicle_brand        as string | null) || null,
    vehicle_model:        (parsed.vehicle_model        as string | null) || null,
    vehicle_vin:          (parsed.vehicle_vin          as string | null) || null,
    vehicle_fuel:         (parsed.vehicle_fuel         as string | null) || null,
    vehicle_gearbox:      (parsed.vehicle_gearbox      as string | null) || null,
    incident_address:     (parsed.incident_address     as string | null) || null,
    incident_city:        (parsed.incident_city        as string | null) || null,
    incident_country:     (parsed.incident_country     as string)        || 'BE',
    destination_name:     (parsed.destination_name     as string | null) || null,
    destination_address:  (parsed.destination_address  as string | null) || null,
    amount_guaranteed:    parsed.amount_guaranteed != null
                            ? parseFloat(String(parsed.amount_guaranteed)) || null
                            : null,
    incident_at:          (parsed.incident_at          as string | null) || null,
    confidence:           parseFloat(String(parsed.confidence))          || 0.5,
  }
}
