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
  verdict: 'dsp' | 'rem' | 'controle' | 'incomplet'
  fr: { codes: { code: string; libelle: string; gravite: 'grave' | 'moyen' | 'leger'; ref?: boolean }[]; resume: string; pourquoi: string; a_essayer: string[]; partiel?: string | null }
  sq: { codes: { code: string; libelle: string }[]; resume: string; pourquoi: string; a_essayer: string[]; partiel?: string | null }
}

export interface Lecture { complete: boolean; muette: boolean; manques: string[] }
export interface Symptome { panne: string | null; description: string | null; boite: string | null; kilometrage: string | number | null }

/** Marque → liste de codes constructeur disponible dans la base (les codes génériques valent pour toutes). */
function marqueRef(marque: string | null | undefined): string | null {
  const m = String(marque || '').toLowerCase()
  const table: [RegExp, string][] = [[/volkswagen|\bvw\b|seat|cupra|skoda|škoda/, 'VOLKSWAGEN'], [/audi/, 'AUDI'], [/bmw|mini/, 'BMW'], [/ford/, 'FORD'], [/mercedes/, 'MERCEDES'], [/toyota/, 'TOYOTA'], [/lexus/, 'LEXUS'], [/kia/, 'KIA'], [/nissan/, 'NISSAN'], [/mazda/, 'MAZDA'], [/honda/, 'HONDA'], [/subaru/, 'SUBARU'], [/suzuki/, 'SUZUKI'], [/mitsubishi/, 'MITSUBISHI'], [/jeep/, 'JEEP'], [/jaguar/, 'JAGUAR'], [/dodge/, 'DODGE'], [/chrysler/, 'CHRYSLER']]
  return table.find(([r]) => r.test(m))?.[1] || null
}

/** Définitions de référence des codes lus : Sam part de là au lieu de sa mémoire. Un code absent reste « à vérifier ». */
export async function definitionsCodes(codes: string[], marque: string | null | undefined): Promise<Map<string, { libelle: string; detail: string | null; constructeur: boolean }>> {
  const out = new Map<string, { libelle: string; detail: string | null; constructeur: boolean }>()
  if (!codes.length) return out
  const mq = marqueRef(marque)
  const { data } = await createAdminClient().from('obd_dtc_ref').select('code, marque, libelle, detail').in('code', codes).in('marque', mq ? ['GENERIQUE', mq] : ['GENERIQUE'])
  for (const r of (data || []) as any[]) {
    const existant = out.get(r.code)
    if (!existant || r.marque !== 'GENERIQUE') out.set(r.code, { libelle: r.libelle, detail: r.detail, constructeur: r.marque !== 'GENERIQUE' })
  }
  return out
}

const AVIS_MUETTE: Analysis = {
  verdict: 'incomplet',
  fr: { codes: [], resume: 'La voiture ne répond pas', pourquoi: 'Le boîtier est connecté, mais aucune donnée ne revient de la voiture. Cela ne veut pas dire qu’elle n’a rien.', a_essayer: ['Mettre le contact', 'Bien enfoncer le boîtier dans la prise', 'Relancer la lecture'], partiel: null },
  sq: { codes: [], resume: 'Makina nuk përgjigjet', pourquoi: 'Pajisja është e lidhur, por nuk vijnë të dhëna nga makina. Kjo nuk do të thotë që makina nuk ka asgjë.', a_essayer: ['Ndiz kontaktin', 'Fute mirë pajisjen në prizë', 'Rinis leximin'], partiel: null },
}

/** Avis de Sam : libellé de chaque code en fr et sq, dépannage sur place (DSP) ou remorquage (REM). */
export async function analyse(input: { codes: { code: string; type: string; ecu?: string }[]; measures: any; vehicle: Vehicle | null; vin: string | null; lecture?: Lecture | null; freeze?: any; symptome?: Symptome | null }): Promise<Analysis> {
  const lecture = input.lecture || null
  if (lecture?.muette) return AVIS_MUETTE
  const client = aiClient('obd/analyse', { apiKey: process.env.ANTHROPIC_API_KEY! }) as Anthropic
  const v = input.vehicle
  const defs = await definitionsCodes(input.codes.map(c => c.code), v?.marque).catch(() => new Map())
  const typeLabel = (t: string) => t === 'en_attente' ? 'en attente' : t === 'permanent' ? 'permanent' : 'mémorisé'
  const lignesRef = input.codes.map(c => { const d = defs.get(c.code); return `- ${c.code} (${typeLabel(c.type)}) : ${d ? `${d.libelle}${d.constructeur ? ' [définition constructeur à confirmer]' : ''}${d.detail ? ` — causes fréquentes : ${d.detail}` : ''}` : 'AUCUNE DÉFINITION DE RÉFÉRENCE'}` }).join('\n')
  const s = input.symptome
  const panne = s ? [s.panne, s.description].filter(Boolean).join(' — ') : ''
  const prompt = `Tu es Sam, l'assistant des dépanneurs de Verviers Dépannage. Un chauffeur vient de lire la voiture avec un boîtier OBD, sur le bord de la route.
Véhicule : ${v ? [v.marque, v.modele, v.motorisation, v.annee].filter(Boolean).join(' · ') : 'inconnu'}${input.vin ? ` (VIN ${input.vin})` : ''}.${s?.boite ? `\nBoîte : ${s.boite}.` : ''}${s?.kilometrage ? `\nKilométrage sur la fiche : ${s.kilometrage}.` : ''}
Panne signalée (texte de l'assistance, simple information) : ${panne || 'non renseignée'}.
Codes de panne et définitions de référence :
${lignesRef || 'aucun'}
Mesures lues par le boîtier : ${JSON.stringify(input.measures)}.
Image figée au moment du défaut : ${input.freeze ? JSON.stringify(input.freeze) : 'aucune'}.
État de la lecture : ${lecture ? (lecture.complete ? 'complète' : `INCOMPLÈTE (${lecture.manques.join(', ')})`) : 'inconnu'}.

Dis au chauffeur si un DÉPANNAGE SUR PLACE est raisonnable (batterie, connecteur, fusible, capteur sans risque, code ancien sans symptôme…) ou si le REMORQUAGE s'impose (risque moteur, boîte, freins, direction, airbag, refroidissement, fuite…). « controle » seulement s'il n'y a aucun code, que la lecture est complète et que rien n'est anormal.
Règles : phrases courtes et concrètes, sans jargon ; le chauffeur ne peut pas te répondre sur cet écran, ne lui pose aucune question et ne lui demande pas de te décrire quoi que ce soit ; c'est un pré-diagnostic, la décision reste au chauffeur.
Libellés : traduis la définition de référence, sans inventer. Pour une « AUCUNE DÉFINITION DE RÉFÉRENCE », écris seulement « Code propre à la marque, à vérifier » et ne lui donne pas de sens précis.
Lecture incomplète : ne dis jamais que la voiture n'a rien ; explique ce qui manque dans « partiel » et conseille de relancer. Un témoin allumé sans code veut dire que le boîtier ne voit pas tout.
Carburant : seul celui des mesures compte ; s'il manque, n'en suppose aucun. Hybride ou électrique : le boîtier ne lit pas la batterie de traction ni ses défauts, dis-le dans « partiel » et ne propose aucune manipulation sur la partie haute tension.
Certaines marques cachent leurs codes propres : si les codes ne suffisent pas à expliquer la panne signalée, dis-le dans « partiel ».
Réponds en JSON STRICT, sans texte autour :
{"verdict":"dsp|rem|controle","fr":{"codes":[{"code":"P0301","libelle":"…","gravite":"grave|moyen|leger"}],"resume":"titre court","pourquoi":"1 ou 2 phrases","a_essayer":["…"],"partiel":null},"sq":{"codes":[{"code":"P0301","libelle":"… en albanais"}],"resume":"…","pourquoi":"…","a_essayer":["…"],"partiel":null}}
« sq » = la même chose en albanais simple.`
  const res = await client.messages.create({ model: ANTHROPIC_MODEL, max_tokens: 2500, messages: [{ role: 'user', content: prompt }] })
  const t = res.content.find(b => b.type === 'text')
  if (!t || t.type !== 'text') throw new Error('Avis indisponible')
  const j = JSON.parse(t.text.trim().replace(/^```json\s*/, '').replace(/```\s*$/, ''))
  if (!['dsp', 'rem', 'controle'].includes(j.verdict)) j.verdict = input.codes.length ? 'rem' : 'controle'
  // Le code garde la main : sans lecture complète, jamais « rien d'anormal ».
  if (j.verdict === 'controle' && lecture && !lecture.complete) j.verdict = 'incomplet'
  for (const c of j.fr?.codes || []) c.ref = defs.has(c.code)
  return j as Analysis
}

/** Famille de carburant de la fiche (liste du dispatch), depuis le texte du boîtier ou de la fiche. */
function familleCarburant(s: string | null | undefined): string | null {
  const t = String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (!t) return null
  if (/hybrid|electrique et thermique/.test(t)) return 'Hybride'
  if (/gpl|lpg/.test(t)) return 'GPL'
  if (/electr/.test(t)) return 'Électrique'
  if (/diesel/.test(t)) return 'Diesel'
  if (/essence|sans plomb|gasoline/.test(t)) return 'Essence'
  return null
}

/**
 * Le boîtier fait foi sur le carburant (Olivier 06/11/2026) : il corrige la fiche, et c'est noté dans son historique.
 * Déduit de l'allumage, il ne distingue pas un hybride ou un GPL : il ne contredit donc pas ces deux-là.
 */
export async function corrigerCarburantFiche(sb: any, missionId: string, measures: any, numero: string, userId: string): Promise<void> {
  const lu = familleCarburant(measures?.carburant)
  if (!lu) return
  const { data: m } = await sb.from('incoming_missions').select('vehicle_fuel').eq('id', missionId).maybeSingle()
  if (!m) return
  const fiche = familleCarburant(m.vehicle_fuel)
  if (fiche === lu) return
  if (measures?.carburant_source === 'allumage' && (fiche === 'Hybride' || fiche === 'GPL')) return
  const { error } = await sb.from('incoming_missions').update({ vehicle_fuel: lu }).eq('id', missionId)
  if (error) return
  await sb.from('mission_logs').insert({ mission_id: missionId, actor_id: userId, action: 'obd_diagnostic',
    notes: `Carburant corrigé par le boîtier (diagnostic ${numero}) : « ${m.vehicle_fuel || 'vide'} » → « ${lu} »`, metadata: { avant: m.vehicle_fuel, apres: lu, source: measures?.carburant_source || null } }).then(() => {}, () => {})
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
