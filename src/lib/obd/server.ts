// src/lib/obd/server.ts — diagnostic OBD côté serveur (Olivier 05/11/2026, maquette validée
// https://claude.ai/artifact/F1KAFhsPsLkFqvgZvQS8oS). Préversion : drapeau « obd_diagnostic », Mobi, Olivier et Franck.
import { createAdminClient } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'
import { aiClient } from '@/lib/ai/usage'
import { ANTHROPIC_MODEL } from '@/lib/anthropic-model'
import { isPreviewOn } from '@/lib/feature-flags'
import { checkVin, cleanVin } from './vin'

export async function obdAccess(user: any): Promise<boolean> {
  return !!user?.id && await isPreviewOn('obd_diagnostic', user.role, user.id)
}

export interface Vehicle { marque: string | null; modele: string | null; motorisation: string | null; annee: number | null; source: 'vpic' | 'vin' }

/** Décodage du VIN : base publique vPIC (NHTSA, gratuite), sinon marque et année tirées du VIN. */
/** La base américaine ignore le modèle des VIN européens (Opel 2020 sans « Combo », Olivier 06/11/2026) : on le cherche
 *  dans nos fiches, le même châssis d'abord, puis les mêmes premiers caractères (9 fois sur 10 le bon modèle sur 219 essais). */
async function modeleDepuisFiches(vin: string): Promise<{ modele: string; estime: boolean } | null> {
  const sb = createAdminClient()
  for (const n of [17, 8, 6]) {
    const { data } = await sb.from('incoming_missions').select('vehicle_model').ilike('vehicle_vin', n === 17 ? vin : `${vin.slice(0, n)}%`).not('vehicle_model', 'is', null).limit(200)
    const compte = new Map<string, number>()
    for (const x of (data || []) as any[]) { const m = String(x.vehicle_model).trim(); if (m && !/^(autre|inconnu|\?+|-+)$/i.test(m)) compte.set(m, (compte.get(m) || 0) + 1) }
    const total = [...compte.values()].reduce((a, b) => a + b, 0)
    const [top] = [...compte.entries()].sort((a, b) => b[1] - a[1])
    if (top && (n === 17 || (total >= 2 && top[1] / total >= 0.6))) return { modele: top[0], estime: n !== 17 }
  }
  return null
}

export async function decodeVin(raw: string): Promise<Vehicle | null> {
  const v = await decodeVinBase(raw)
  if (!v || v.modele) return v
  const f = await modeleDepuisFiches(cleanVin(raw)).catch(() => null)
  return f ? { ...v, modele: f.estime ? `${f.modele} ?` : f.modele, source: v.source } : v
}

async function decodeVinBase(raw: string): Promise<Vehicle | null> {
  const vin = cleanVin(raw)
  const c = checkVin(vin)
  if (!c.valid) return null
  const base: Vehicle = { marque: c.brand, modele: null, motorisation: null, annee: c.year, source: 'vin' }
  try {
    const r = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    const j = await r.json()
    const x = j?.Results?.[0] || {}
    const moteur = [x.DisplacementL ? `${Number(x.DisplacementL).toFixed(1)} L` : null, x.FuelTypePrimary || null, x.EngineHP ? `${x.EngineHP} ch` : null].filter(Boolean).join(' · ')
    const marque = x.Make ? String(x.Make).replace(/\b\w/g, (m: string) => m.toUpperCase()).replace(/\B\w+/g, (m: string) => m.toLowerCase()) : null
    return { marque: marque || base.marque, modele: x.Model || null, motorisation: moteur || null, annee: Number(x.ModelYear) || base.annee, source: (x.Make || x.Model) ? 'vpic' : 'vin' }
  } catch { return base }
}

export interface Analysis {
  verdict: 'dsp' | 'rem' | 'controle'
  fr: { codes: { code: string; libelle: string; gravite: 'grave' | 'moyen' | 'leger' }[]; resume: string; pourquoi: string; a_essayer: string[]; partiel?: string | null }
  sq: { codes: { code: string; libelle: string }[]; resume: string; pourquoi: string; a_essayer: string[]; partiel?: string | null }
}

/** Avis de Sam : libellé de chaque code en fr et sq, dépannage sur place (DSP) ou remorquage (REM). */
export async function analyse(input: { codes: { code: string; type: string }[]; measures: any; vehicle: Vehicle | null; vin: string | null }): Promise<Analysis> {
  const client = aiClient('obd/analyse', { apiKey: process.env.ANTHROPIC_API_KEY! }) as Anthropic
  const v = input.vehicle
  const prompt = `Tu es Sam, l'assistant des dépanneurs de Verviers Dépannage. Un chauffeur vient de lire la voiture avec un boîtier OBD, sur le bord de la route.
Véhicule : ${v ? [v.marque, v.modele, v.motorisation, v.annee].filter(Boolean).join(' · ') : 'inconnu'}${input.vin ? ` (VIN ${input.vin})` : ''}.
Codes de panne : ${input.codes.length ? input.codes.map(c => `${c.code} (${c.type === 'en_attente' ? 'en attente' : 'mémorisé'})`).join(', ') : 'aucun'}.
Mesures : ${JSON.stringify(input.measures)}.

Dis au chauffeur si un DÉPANNAGE SUR PLACE est raisonnable (batterie, connecteur, fusible, capteur sans risque, code ancien sans symptôme…) ou si le REMORQUAGE s'impose (risque moteur, boîte, freins, direction, airbag, refroidissement, fuite…). « controle » seulement s'il n'y a aucun code et rien d'anormal.
Règles : phrases courtes et concrètes, sans jargon ; le chauffeur ne peut pas te répondre sur cet écran, ne lui pose aucune question et ne lui demande pas de te décrire quoi que ce soit ; c'est un pré-diagnostic, la décision reste au chauffeur. Certaines marques cachent leurs codes propres : si les codes ne suffisent pas à expliquer la panne décrite, dis-le dans « partiel ».
Réponds en JSON STRICT, sans texte autour :
{"verdict":"dsp|rem|controle","fr":{"codes":[{"code":"P0301","libelle":"…","gravite":"grave|moyen|leger"}],"resume":"titre court","pourquoi":"1 ou 2 phrases","a_essayer":["…"],"partiel":null},"sq":{"codes":[{"code":"P0301","libelle":"… en albanais"}],"resume":"…","pourquoi":"…","a_essayer":["…"],"partiel":null}}
« sq » = la même chose en albanais simple.`
  const res = await client.messages.create({ model: ANTHROPIC_MODEL, max_tokens: 1800, messages: [{ role: 'user', content: prompt }] })
  const t = res.content.find(b => b.type === 'text')
  if (!t || t.type !== 'text') throw new Error('Avis indisponible')
  const j = JSON.parse(t.text.trim().replace(/^```json\s*/, '').replace(/```\s*$/, ''))
  if (!['dsp', 'rem', 'controle'].includes(j.verdict)) j.verdict = input.codes.length ? 'rem' : 'controle'
  return j as Analysis
}

/** Interventions du même véhicule (VIN ou plaque), ouvertes ou des 30 derniers jours : proposées, jamais imposées. */
export async function matchingMissions(sb: any, vin: string | null, plate: string | null): Promise<{ id: string; mission_number: number; label: string }[]> {
  const ors: string[] = []
  if (vin && vin.length === 17) ors.push(`vehicle_vin.ilike.${vin}`)
  const p = String(plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (p.length >= 4) ors.push(`vehicle_plate.ilike.${p}`)
  if (!ors.length) return []
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const { data } = await sb.from('incoming_missions').select('id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, status, received_at')
    .or(ors.join(',')).eq('dossier_leg', false).gte('received_at', since).not('status', 'in', '("cancelled","ignored","parse_error")')
    .order('received_at', { ascending: false }).limit(3)
  return (data || []).map((m: any) => ({ id: m.id, mission_number: m.mission_number, label: `#${m.mission_number} · ${[m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ')} ${m.vehicle_plate || ''} · ${['completed', 'to_invoice'].includes(m.status) ? 'terminée' : 'en cours'}` }))
}
