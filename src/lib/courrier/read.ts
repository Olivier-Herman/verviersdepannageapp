// src/lib/courrier/read.ts — lecture d'un courrier (pages scannées ou photographiées)
// par Claude : expéditeur, destinataire (quelle société), type, plaque, référence,
// montant, échéance. Images et PDF acceptés. Olivier 29/09/2026.

import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODELS, createWithModelFallback } from '@/lib/anthropic-model'
import { COMPANIES } from '@/lib/mail-agent/handlers/fournisseur'
import { DOC_TYPES, ENTITIES, type CourrierReading, type DocType, type EntityKey } from './types'
import { aiClient } from '@/lib/ai/usage'

let client: Anthropic | null = null
const getClient = () => {
  if (client) return client
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY manquante')
  return (client = aiClient('courrier/read', { apiKey: process.env.ANTHROPIC_API_KEY }))
}

const PROMPT = `Tu lis un courrier papier reçu par un groupe de dépannage belge (scan ou photo, une ou plusieurs pages, souvent en français, parfois en néerlandais ou allemand).
Le groupe a trois sociétés :
- "vd" = ${COMPANIES.vd.label} (TVA ${COMPANIES.vd.vat}) : dépannage, remorquage, fourrière, gardiennage de véhicules pour la police et les assistances ;
- "riga" = ${COMPANIES.riga.label} (TVA ${COMPANIES.riga.vat}) ;
- "dgj" = ${COMPANIES.dgj.label} (TVA ${COMPANIES.dgj.vat}) : centre de véhicules hors d'usage (VHU).
Détermine à quelle société le courrier est adressé (nom, adresse, n° de TVA du destinataire).

Types possibles (clé → sens) :
${Object.entries(DOC_TYPES).map(([k, v]) => `- ${k} : ${v}`).join('\n')}

Retourne UNIQUEMENT un JSON strict, sans markdown :
{
  "sender": <string|null>,        // expéditeur, nom court lisible (ex. "Ethias", "Zone de police Vesdre", "TotalEnergies")
  "sender_email": <string|null>,
  "addressed_to": <string|null>,  // destinataire tel qu'écrit
  "entity": <"vd"|"riga"|"dgj"|null>,
  "entity_conf": <0-100>,
  "doc_type": <une des clés ci-dessus>,
  "type_conf": <0-100>,
  "summary": <string>,            // 1 à 2 phrases en français : ce que dit le courrier et ce qu'il demande
  "plate": <string|null>,         // plaque citée (format belge 1-ABC-123 si possible)
  "vin": <string|null>,
  "reference": <string|null>,     // n° de PV, sinistre, dossier, facture… le plus utile
  "amount_eur": <number|null>,    // montant principal TVAC
  "due_date": <string|null>,      // JJ/MM/AAAA
  "doc_date": <string|null>,      // JJ/MM/AAAA
  "handwritten": <boolean>,
  "facts": [[<libellé>, <valeur>], …]   // 3 à 6 lignes clés à afficher (Expéditeur, Adressé à, Plaque, Référence, Montant, Échéance, Demande…)
}
N'invente rien : null si absent ou illisible.`

export async function readCourrier(pages: { base64: string; mime: string }[]): Promise<CourrierReading> {
  const content: any[] = pages.map(p => p.mime === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.base64 } }
    : { type: 'image', source: { type: 'base64', media_type: p.mime, data: p.base64 } })
  content.push({ type: 'text', text: 'Lis ce courrier et retourne uniquement le JSON.' })
  const resp = await createWithModelFallback(getClient(), ANTHROPIC_MODELS, { max_tokens: 1500, system: PROMPT, messages: [{ role: 'user', content }] })
  const text = (resp.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
  // Réponse parfois entourée de texte : on garde du premier « { » au dernier « } ».
  const cleaned = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  let j: any
  try { j = JSON.parse(cleaned) } catch { throw new Error('Lecture illisible, réessayez') }
  const entity = (j.entity && j.entity in ENTITIES ? j.entity : null) as EntityKey | null
  const doc_type = (j.doc_type && j.doc_type in DOC_TYPES ? j.doc_type : 'autre') as DocType
  return {
    sender: j.sender || null, sender_email: j.sender_email || null, addressed_to: j.addressed_to || null,
    entity, entity_conf: Number(j.entity_conf) || 0, doc_type, type_conf: Number(j.type_conf) || 0,
    summary: String(j.summary || ''), plate: j.plate || null, vin: j.vin || null, reference: j.reference || null,
    amount_eur: j.amount_eur != null && !isNaN(Number(j.amount_eur)) ? Number(j.amount_eur) : null,
    due_date: j.due_date || null, doc_date: j.doc_date || null, handwritten: !!j.handwritten,
    facts: Array.isArray(j.facts) ? j.facts.filter((f: any) => Array.isArray(f) && f.length === 2).map((f: any) => [String(f[0]), String(f[1])]).slice(0, 8) : [],
  }
}
