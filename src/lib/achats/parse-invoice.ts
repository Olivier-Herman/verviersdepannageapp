// ============================================================
// VERVIERS DÉPANNAGE — Catégorisation IA des factures fournisseurs
// ------------------------------------------------------------
// Parse le DOCUMENT d'une facture (PDF ou XML e-invoicing) avec Claude et en
// déduit DE QUOI IL S'AGIT : catégorie normalisée + résumé + lignes.
// On ne se fie PAS aux comptes comptables Odoo (trop grossiers).
// Modèle : ANTHROPIC_MODEL centralisé (Opus 4.8) — cohérent avec l'app.
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL } from '@/lib/anthropic-model'

// Taxonomie fermée (dépannage / garage). L'IA DOIT choisir dans cette liste.
export const CATEGORIES = [
  'Carburant',
  'Péages & frais de route',
  'Sous-traitance dépannage',
  'Pièces & fournitures véhicules',
  'Pneus',
  'Entretien & réparation véhicules',
  'Achat & location véhicules',
  'Assurances',
  'Télécom & informatique',
  'Énergie',
  'Loyers & immobilier',
  'Frais bancaires & financiers',
  'Honoraires & services externes',
  'Charges sociales & salaires',
  'Taxes & redevances',
  'Amendes routières',
  'Petit matériel & fournitures',
  'Publicité & marketing',
  'Acompte / à régulariser',
  'Autre',
] as const

let _client: Anthropic | null = null
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  return _client
}

const PROMPT = `Tu es analyste achats pour une société de DÉPANNAGE / REMORQUAGE automobile (VD Soft — Verviers Dépannage).
On te donne le document d'une FACTURE FOURNISSEUR (PDF ou XML e-facture). Analyse-la LIGNE PAR LIGNE : chaque ligne peut relever d'une catégorie DIFFÉRENTE.

Réponds UNIQUEMENT par un objet JSON valide (aucun texte autour), structure EXACTE :
{
  "categorie": "<catégorie DOMINANTE de la facture (celle du plus gros montant), valeur EXACTE de la liste>",
  "resume": "<1 phrase: ce qui a été acheté>",
  "items": [
    {
      "description": "<libellé de la ligne>",
      "montant": <montant HTVA de CETTE ligne (nombre) — les montants des lignes doivent SOMMER au total HTVA de la facture>,
      "categorie": "<catégorie EXACTE de CETTE ligne parmi la liste>",
      "plaque": "<immatriculation MAJUSCULES sans espaces ni tirets si la ligne concerne un véhicule précis, sinon null>"
    }
  ],
  "confidence": <0..1>
}

CATÉGORIES AUTORISÉES (choisir la plus proche par ligne, sinon "Autre") :
${CATEGORIES.map(c => `- ${c}`).join('\n')}

Règles IMPORTANTES :
- Analyse CHAQUE ligne séparément et donne-lui SA catégorie (une facture peut mélanger téléphonie, honoraires, carburant…).
- "Acompte / à régulariser" = toute ligne d'ACOMPTE / provision / avance (souvent libellée « Acompte », « Down payment »). Ces lignes se soldent sur la facture finale → NE PAS les ranger dans un vrai poste, mets "Acompte / à régulariser".
- "Charges sociales & salaires" (ONSS, précompte, secrétariat social) = dépense normale.
- "Sous-traitance dépannage" = un autre dépanneur qui a réalisé une intervention pour nous.
- Cartes carburant/péage (AS24, DKV, Eurotoll, Total, Q8, Shell, TotalEnergies…) : lignes de carburant/gasoil/AdBlue → "Carburant" ; lignes de péage/tunnel/vignette/parking → "Péages & frais de route". JAMAIS "Honoraires".
- Police Fédérale, SPF Justice/Finances pour une amende, perception immédiate, PV, infraction de roulage → "Amendes routières" (PAS "Taxes & redevances").
- montant : HTVA par ligne, obligatoire (estime au mieux). La somme des lignes ≈ total HTVA de la facture.
- plaque : uniquement si la ligne vise un véhicule identifié (carburant, garage, pneus). Sinon null.
- Si illisible : confidence bas, une seule ligne categorie "Autre".`

export interface CatLine { description: string; montant: number; categorie: string; plaque: string | null }
export interface Categorization {
  categorie: string
  resume: string | null
  items: CatLine[]
  confidence: number
}

/** Normalise une plaque : MAJ, [A-Z0-9], sans le code pays « BE » de tête
 *  (les documents affichent souvent « BE-2-ECA-631 » → 2ECA631). */
export const normPlate = (p: string) =>
  String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^BE(?=\d)/, '')

/**
 * Envoie le document (base64) à Claude et renvoie la catégorisation.
 * mimetype : 'application/pdf' → bloc document ; sinon (XML/texte) → texte décodé.
 */
export async function categorizeInvoiceDoc(opts: {
  supplierName: string
  ref?: string | null
  amountHtva?: number | null
  docBase64: string
  mimetype: string
}): Promise<Categorization> {
  const client = getClient()
  const ctx = `Fournisseur: ${opts.supplierName}${opts.ref ? ` · Réf: ${opts.ref}` : ''}${opts.amountHtva != null ? ` · Total HTVA: ${opts.amountHtva} €` : ''}`

  const content: any[] = []
  if (opts.mimetype.includes('pdf')) {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: opts.docBase64 } })
  } else {
    // XML / texte : on décode et on tronque (les UBL/Peppol sont verbeux).
    let text = ''
    try { text = Buffer.from(opts.docBase64, 'base64').toString('utf8') } catch { text = '' }
    content.push({ type: 'text', text: `Document (${opts.mimetype}) :\n${text.slice(0, 20000)}` })
  }
  content.push({ type: 'text', text: `${PROMPT}\n\nContexte : ${ctx}` })

  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content }],
  })

  const block = response.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('Aucun texte retourné par Claude')
  const cleaned = block.text.trim().replace(/^```json\s*/, '').replace(/```\s*$/, '').trim()
  const parsed = JSON.parse(cleaned)

  const normCat = (c: any) => (CATEGORIES as readonly string[]).includes(c) ? c : 'Autre'
  const items: CatLine[] = (Array.isArray(parsed.items) ? parsed.items : []).slice(0, 12).map((l: any) => {
    const pl = normPlate(l.plaque)
    return {
      description: String(l.description || '').slice(0, 120),
      montant: typeof l.montant === 'number' ? l.montant : 0,
      categorie: normCat(l.categorie),
      plaque: pl.length >= 4 ? pl : null,
    }
  })
  // Catégorie dominante : la plus grosse par montant (fallback = champ fourni).
  const byCat: Record<string, number> = {}
  for (const it of items) byCat[it.categorie] = (byCat[it.categorie] || 0) + (it.montant || 0)
  const dominant = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0]?.[0]
  return {
    categorie: dominant || normCat(parsed.categorie),
    resume: parsed.resume || null,
    items,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
  }
}
