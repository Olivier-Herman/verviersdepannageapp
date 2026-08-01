// src/lib/prestations/parse-sheet.ts
//
// Lecture d'une FEUILLE DE PRESENCE EasyPay (PDF dans le ZIP mensuel, fichier
// *FEUILLES_DE_PRESTATIONS*). Claude extrait, par travailleur, les heures
// pré-remplies jour par jour (la grille) + les métadonnées. Robuste (le texte
// brut du PDF perd l'alignement des colonnes → on laisse Claude lire le visuel).

import JSZip from 'jszip'
import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL } from '@/lib/anthropic-model'

/** Extrait le PDF de la feuille de présence d'un ZIP EasyPay. */
export async function extractPrestationsPdf(zipBuffer: Buffer): Promise<Uint8Array | null> {
  const zip = await JSZip.loadAsync(zipBuffer)
  const entry = Object.values(zip.files).find(f => /FEUILLES?_DE_PRESTATIONS/i.test(f.name) && /\.pdf$/i.test(f.name))
  if (!entry) return null
  return await entry.async('uint8array')
}

export interface PrestWorker {
  matricule: string; name: string; departement: string | null; statut: string | null
  qs: string | null; fonction: string | null
  days: Record<string, number>; conges_jours: number | null; conges_heures: number | null
}
export interface PrestSheet { period: string; company_code: string; workers: PrestWorker[] }

export async function parsePrestationSheet(pdfBytes: Uint8Array): Promise<PrestSheet> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const pdfB64 = Buffer.from(pdfBytes).toString('base64')
  const prompt = `Ceci est une FEUILLE DE PRESENCE (prestations) du secrétariat social EasyPay, pré-remplie, période mensuelle. Extrais les données en JSON STRICT (aucun texte hors JSON) :
{
 "period": "AAAA-MM",  // période en haut, ex "Periode : 01/08/2026 31/08/2026" -> "2026-08"
 "company_code": "438",  // code entre parenthèses de l'entête employeur
 "workers": [ {
   "matricule": "<No. du travailleur, ex 5>",
   "name": "<Nom travailleur exactement>",
   "departement": "<ex OUVRIERS ou null>",
   "statut": "<ex Ouvrier ou null>",
   "qs": "<Q/S heures/semaine, ex '38,00/38,00' ou null>",
   "fonction": "<Fonction ou null>",
   "days": { "1": <heures ce jour>, "2": <...>, ... },
   "conges_jours": <nombre JOURS CONGES ou null>,
   "conges_heures": <nombre HEURES congés ou null>
 } ]
}
RÈGLES IMPORTANTES :
- "days" couvre TOUS les jours du mois (de "1" au dernier jour), valeur = heures prestées ce jour en DÉCIMAL (0 si aucune prestation, ex week-end).
- Les heures sont imprimées SANS séparateur décimal : 800 = 8 heures, 600 = 6, 400 = 4, 750 = 7,5. Convertis en décimal (divise par 100).
- Aligne fidèlement la ligne "Heures" de chaque travailleur sur les jours 01,02,03… de l'entête calendaire.
- Une entrée par travailleur.`
  const res = await client.messages.create({
    model: ANTHROPIC_MODEL, max_tokens: 8000,
    messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 } },
      { type: 'text', text: prompt },
    ] }],
  })
  const block = res.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('Aucun texte de Claude')
  const cleaned = block.text.trim().replace(/^```json\s*/, '').replace(/```\s*$/, '').trim()
  const parsed = JSON.parse(cleaned)
  return { period: parsed.period, company_code: String(parsed.company_code || ''), workers: parsed.workers || [] }
}
