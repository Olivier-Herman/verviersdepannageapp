// src/lib/fourriere/destruction-dossier.ts
//
// Dossier de destruction (Olivier 10/09/2026). Voir la migration 202609101300.
//  - coût À UNE DATE : le compteur ne s'arrête pas à la destruction — le jour où
//    quelqu'un se présente, on lui présente les frais à la date de sa présentation ;
//  - description du véhicule lue sur les photos (VIN, marque, modèle, couleur,
//    état) — PAS de kilométrage, on n'a pas les clés ; les plaques ont disparu ;
//  - numéro de dossier interne DEST-AAAA-NNNN ;
//  - aucun envoi à la commune, aucune facture Odoo.
import type { createAdminClient } from '@/lib/supabase'
import { getRestitutionGrid } from '@/lib/fourriere/restitution-grid'
import { RESTITUTION_FALLBACK } from '@/lib/fourriere/restitution-grid-data'
import { computeDestructionFees, type DestructionFees } from '@/lib/fourriere/destruction-report'
import { extractJsonFromImages } from '@/lib/ocr/vision-json'
import { getBusinessText } from '@/lib/settings/business'

type Sb = ReturnType<typeof createAdminClient>

export interface DestructionDossier {
  id: string; dossier_number: string; mission_id: string | null; qr_scanned: boolean
  vin: string | null; vin_image: number | null; plate: string | null
  brand: string | null; model: string | null; color: string | null
  condition: VehicleCondition | null; photos: string[]
  parc_zone_key: string | null; entered_at: string | null; exited_at: string
  grid_source: string; regime: string | null; cost_snapshot: DestructionFees | null
  epaviste: string | null; forced: boolean; forced_reason: string | null
  created_by: string | null; created_by_name: string | null; notes: string | null
  created_at: string; updated_at: string
}
export interface VehicleCondition {
  carrosserie?: string | null; vitres?: string | null; roues?: string | null; interieur?: string | null; remarques?: string | null
}
export interface VehicleDescription {
  vin: string | null; vin_image: number | null; plate: string | null
  brand: string | null; model: string | null; color: string | null
  condition: VehicleCondition; confidence: 'haute' | 'moyenne' | 'basse'
}

/** Grille de restitution à appliquer : celle de la source si elle en a une, sinon l'abandon (AVP). */
export async function gridSourceFor(source: string | null | undefined): Promise<string> {
  const s = String(source || '').toLowerCase()
  if (s && (RESTITUTION_FALLBACK[s] || (await getRestitutionGrid(s)))) return s
  return 'police_avp'
}

/** Frais à une date (défaut : maintenant) — même moteur que la Sortie AVP. */
export async function costAtDate(d: Pick<DestructionDossier, 'entered_at' | 'grid_source'>, atIso?: string): Promise<DestructionFees & { at: string; grid: { forfaitHtva: number; parcDayHtva: number; label: string } }> {
  const grid = (await getRestitutionGrid(d.grid_source)) || RESTITUTION_FALLBACK[d.grid_source] || RESTITUTION_FALLBACK.police_avp
  const at = atIso || new Date().toISOString()
  const fees = computeDestructionFees(d.entered_at, at, { forfaitHtva: grid.forfaitHtva, parcDayHtva: grid.parcDayHtva })
  return { ...fees, at, grid: { forfaitHtva: grid.forfaitHtva, parcDayHtva: grid.parcDayHtva, label: grid.label } }
}

export async function nextDossierNumber(sb: Sb): Promise<string> {
  const year = new Date().getFullYear()
  const { count } = await sb.from('destruction_dossiers').select('id', { count: 'exact', head: true }).like('dossier_number', `DEST-${year}-%`)
  return `DEST-${year}-${String((count || 0) + 1).padStart(4, '0')}`
}

export async function epavisteName(): Promise<string> {
  try { return await getBusinessText('epaviste_destruction') } catch { return '' }
}

const DESCRIBE_PROMPT = `Tu décris un VÉHICULE laissé longtemps dans un parc de fourrière, à partir de photos prises au téléphone par le personnel. Les plaques d'immatriculation ont généralement été retirées. Il n'y a PAS de clé : ne cherche pas de kilométrage.

Retourne UNIQUEMENT un JSON strict, sans markdown :
{ "vin":   { "value": "<17 caractères>", "image": <numéro 1..N> } | null,
  "plate": "<plaque si encore lisible>" | null,
  "brand": "<marque>" | null,
  "model": "<modèle>" | null,
  "color": "<couleur principale, un mot ou deux en français>" | null,
  "condition": {
    "carrosserie": "<état : chocs, rayures, rouille, éléments manquants — une phrase>",
    "vitres":      "<intactes / brisées / manquantes — précise lesquelles>",
    "roues":       "<présentes / à plat / manquantes / jantes>",
    "interieur":   "<ce qui se voit : sièges, tableau de bord, objets, moisissure>",
    "remarques":   "<tout ce qui compte pour prouver l'état : végétation, dégâts, ouvert, vandalisé…>"
  },
  "confidence": "haute" | "moyenne" | "basse" }

Règles : VIN = EXACTEMENT 17 caractères (jamais I, O, Q), lu sur la languette du pare-brise, le montant de portière ou une carte grise ; sinon null, ne DEVINE JAMAIS. Marque/modèle/couleur d'après ce qui se voit (logos, silhouette). L'état doit être factuel et sobre : c'est un constat qui sera montré au propriétaire. "image" = numéro de la photo où le VIN a été lu.`

/** Description du véhicule à partir des URLs de photos (Claude vision). */
export async function describeVehicleFromImages(urls: string[]): Promise<{ ok: true; data: VehicleDescription } | { ok: false; error: string }> {
  const images: { base64: string; mimeType: string }[] = []
  for (const u of urls.slice(0, 12)) {
    try {
      const r = await fetch(u); if (!r.ok) continue
      const ct = (r.headers.get('content-type') || '').split(';')[0].trim()
      const mimeType = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(ct) ? ct : 'image/jpeg'
      images.push({ base64: Buffer.from(await r.arrayBuffer()).toString('base64'), mimeType })
    } catch { /* photo injoignable → ignorée */ }
  }
  if (!images.length) return { ok: false, error: 'Aucune photo lisible' }
  const r = await extractJsonFromImages(images, DESCRIBE_PROMPT, `Voici ${images.length} photo(s) du véhicule. Décris-le. JSON strict uniquement.`, 700)
  if (!r.ok) return { ok: false, error: r.error }
  const d = r.data || {}
  const vinRaw = String(d?.vin?.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const vin = /^[A-HJ-NPR-Z0-9]{17}$/.test(vinRaw) ? vinRaw : null
  const s = (v: any) => { const t = v == null ? '' : String(v).trim(); return t ? t : null }
  return { ok: true, data: {
    vin, vin_image: vin && Number.isFinite(Number(d?.vin?.image)) ? Number(d.vin.image) : null,
    plate: s(d.plate), brand: s(d.brand), model: s(d.model), color: s(d.color),
    condition: { carrosserie: s(d?.condition?.carrosserie), vitres: s(d?.condition?.vitres), roues: s(d?.condition?.roues), interieur: s(d?.condition?.interieur), remarques: s(d?.condition?.remarques) },
    confidence: ['haute', 'moyenne', 'basse'].includes(d.confidence) ? d.confidence : 'basse',
  } }
}
