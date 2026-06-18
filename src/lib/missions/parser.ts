// src/lib/missions/parser.ts
// Envoie le contenu extrait à Claude API et retourne les données normalisées

import type { MissionSource, MissionType } from '@/types'
import type { ExtractedContent }           from './extractor'
import { ANTHROPIC_MODELS }                from '@/lib/anthropic-model'

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
- dossier_number = N° Dossier (format 2026BE132588). TOUJOURS l'extraire s'il est présent (il sert à regrouper les emails d'un même dossier — dépannage puis remorquage). Ne jamais le mettre à null si un "N° Dossier" figure dans le document.
- mission_type: "Remorquage" → remorquage | "Depannage" → depannage
- ADRESSES : elles sont dans le bloc "Depannage" EN BAS du document (après "N°Commande", "Date", "Commentaire"), champs "De" et "A" :
  * "De" = incident_address + incident_city (LIEU D'INTERVENTION : rue puis code postal + ville).
  * "A"  = destination_name + destination_address (lieu de remorquage / dépose). Si "A" est vide → destination = null.
  * N'utilise NI le bloc "Incident" du haut NI le bloc "Adresse" (= domicile/siège du membre) pour l'adresse d'intervention. L'adresse d'intervention est TOUJOURS le champ "De" du bloc Depannage en bas.
- client_address = adresse du bloc "Adresse" (domicile/siège du membre), si présente.
- client_name = valeur du champ "Membre" si c'est un nom propre ; sinon le nom de l'"Interlocuteur". Ignore les codes membres (ex "IA8ZUFL") et les raisons sociales si une personne est disponible.
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

  pv_assistance: `SOURCE: P&V Assistance via IMA Benelux. Format identique à ETHIAS.
RÈGLES D'EXTRACTION: identiques à ETHIAS.`,

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

  aginsurance: `SOURCE: AG Insurance via Touring Assistance (RTF "REMORQUAGE FRONTALIER").
RÈGLES D'EXTRACTION:
- Format identique a Touring (meme infrastructure d'assistance).
- external_id = Case Number (ex: 2026BX195768) ou a defaut Reference (L645155467001)
- dossier_number = Reference (L645155467001) ou Case Number
- mission_type = remorquage (REMORQUAGE FRONTALIER explicite dans le titre)
- client_name = champ "Name" (nom de la personne assistee, ex: STAV)
- vehicle_plate = champ "Plaque", vehicle_brand = "Marque", vehicle_model = "Modele"
- vehicle_fuel = champ "Carburant"
- "Localisation du vehicule" = incident_address + incident_city (souvent etranger ex: Allemagne)
- "Adresse de livraison" = destination_name + destination_address (garage Belgique)
- incident_at = champ "Date" format "JJ-MM-AAAA HH:MM:SS" -> ISO 8601`,

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

  eurocross: `SOURCE: Eurocross Assistance Netherlands (PDF "Emergency service guarantee", anglais).
RÈGLES D'EXTRACTION:
- Le PDF a une structure libellé/valeur en colonnes. L'assureur final ("Label") n'est PAS le payeur — c'est Eurocross qui garantit et paye.
- external_id = champ "Our reference" (format NL5870931, possiblement suivi du nom entre parenthèses → garder uniquement la partie avant l'espace)
- dossier_number = même valeur que external_id (Eurocross n'a qu'une seule ref)
- mission_type = "remorquage" par défaut (Emergency service guarantee = remorquage assistance). Si "Vehicle problem" contient "tire/tyre/wheel" ET pas de transport vers garage → "depannage"
- incident_type = champ "Vehicle problem" traduit en français court (Engine malfunction → moteur, Tire flat → pneu crevé, etc.)
- incident_description = "Vehicle problem" + ligne "Additional comments" si présente (sans les coords lat/long techniques)
- client_name = champ "Name" sous Customer details (peut commencer par Mr/Mrs/Mme — conserver tel quel)
- client_phone = champ "Telephone number" sous Customer details (format international, ex +31 6 21 22 27 80)
- client_address = champ "Address" sous Customer details (multi-lignes : rue, code postal + ville)
- vehicle_plate = champ "Number plate" (ex V580FX, sans espace, majuscules)
- "Make & Model" est un seul champ (ex "Ford Transit connect") : 1er mot = vehicle_brand (en majuscules) → "FORD", reste = vehicle_model → "Transit connect"
- vehicle_vin = null (Eurocross ne donne pas le VIN dans ce template)
- vehicle_fuel + vehicle_gearbox : ne sont pas présents → null. NB: "Automatic transmission: Yes/No" → si Yes → "Automatique" sinon "Manuelle"
- "Pick-up address details" = incident_address + incident_city + incident_country (code ISO 2 lettres, "Belgium" → "BE")
- destination_name = null, destination_address = null (Eurocross ne fournit pas la destination ; à déterminer par dispatch)
- amount_guaranteed = null (la "Limited amount" est "Costprice" = pas un montant fixe, c'est une garantie au coût réel)
- incident_at = champ "Date" en haut du PDF (format DD-MM-YYYY) converti en ISO 8601 UTC à 00:00 (Eurocross demande "As soon as possible" donc pas d'heure précise — on prend la date d'émission du message)`,

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

  police:  `SOURCE: Mission créée manuellement via appel Police. Extraire toutes les informations disponibles.`,
  prive:   `SOURCE: Mission créée manuellement via appel privé. Extraire toutes les informations disponibles.`,
  garage:  `SOURCE: Mission créée manuellement par un garage partenaire. Extraire toutes les informations disponibles.`,
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

  // Repli automatique : si un modèle a été retiré (404 not_found), on réessaie
  // avec le suivant de ANTHROPIC_MODELS. Évite que l'intake des missions casse
  // d'un coup quand Anthropic retire un modèle (incident 2026-06-16).
  let res: Response | null = null
  let lastErr = ''
  for (const model of ANTHROPIC_MODELS) {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model, max_tokens: 1024, system: SYSTEM_PROMPT, messages })
    })
    if (res.ok) break
    lastErr = await res.text()
    // 404 = modèle indisponible/retiré → on tente le repli suivant.
    if (res.status === 404) {
      console.error(`[parser] modèle Anthropic "${model}" indisponible (404) — repli sur le suivant. Mets à jour ANTHROPIC_MODEL.`)
      continue
    }
    // Autre erreur (401, 429, 500…) : inutile de changer de modèle.
    break
  }

  if (!res || !res.ok) {
    throw new Error(`Claude API ${res?.status}: ${lastErr.slice(0, 200)}`)
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
