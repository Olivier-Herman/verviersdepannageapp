// src/lib/facturation/facture-enrichie.ts
//
// Facture enrichie (Olivier 23/10/2026, maquette https://claude.ai/artifact/XsmkTmwFGMKCsXYKGdRucR, testée sur la
// copie vd-test2026) : VD Soft remplit des champs de la facture que le modèle d'impression de l'ERP affiche.
//   - x_vd_sinistre     : un mot pris dans une liste fermée (jamais de texte libre) ;
//   - x_vd_client_final : la personne secourue quand la facture va à une assistance ;
//   - x_vd_parcours     : les étapes du dossier, avec des DATES seulement (jamais d'heure, de chauffeur ni de
//                         camion) ; le dépôt de mise au parc vient de la ZONE, jamais du texte de destination ;
//   - x_vd_photos       : 2-3 vignettes « vue d'ensemble du véhicule » choisies par l'IA légère, en fin de facture ;
//   - le VIN de la fiche est recopié sur le véhicule de l'ERP s'il y manque.
// Les libellés des lignes sont nettoyés (plus de codes internes ni de « Intervention du … hh:mm »).
// Interrupteur : réglage « facture_enrichie_actif » (oui / non). Tant qu'il est à « non », rien ne change.
import type { Dossier, DossierLeg } from '@/lib/dossier/build'
import type { QuoteLine } from '@/lib/odoo-quote'
import { nightsBetween } from '@/lib/parc/nights'

export async function factureEnrichieActive(): Promise<boolean> {
  try {
    const { getBusinessText } = await import('@/lib/settings/business')
    return String(await getBusinessText('facture_enrichie_actif')).trim().toLowerCase() === 'oui'
  } catch { return false }
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const day = (v?: string | null) => v ? new Date(v).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric' }) : ''
const isPolice = (m: any) => String(m?.source || '').startsWith('police_') || !!m?.is_police_call

// ── Sinistre : liste fermée ────────────────────────────────────────────────
const SINISTRES: [RegExp, string][] = [
  [/incendi|br[uû]l[ée]|feu\b/i, 'incendie'],
  [/accident|collision|accroch|sinistre|choc|d[ée]g[aâ]t/i, 'accident'],
  [/crev|pneu|jante|roue/i, 'crevaison'],
  [/batter|d[ée]marr/i, 'batterie'],
  [/carbur|panne s[eè]che|essence|gasoil|diesel|erreur.*plein|adblue/i, 'carburant'],
  [/cl[ée]s?\b|cl[ée] (perdue|bloqu|enferm)|verrouill/i, 'clés'],
  [/frein/i, 'freins'],
  [/embray|bo[iî]te|transmission/i, 'embrayage / boîte'],
  [/[ée]lectri|alternat|fusible|calculat/i, 'électrique'],
  [/moteur|courroie|surchauf|refroidiss|huile|turbo/i, 'moteur'],
  [/abandon|avp\b/i, 'abandon'],
  [/saisie|immobilis/i, 'saisie'],
  [/stationnement|mal gar/i, 'stationnement'],
]
export function sinistreCourt(rows: any[]): string | null {
  const txt = rows.flatMap(r => [r?.incident_type, r?.parsed_data?.incident_description, r?.diagnostic, r?.mission_type === 'relivraison' ? '' : r?.mission_type])
    .filter(Boolean).join(' · ')
  for (const [rx, lab] of SINISTRES) if (rx.test(txt)) return lab
  if (rows.some(r => String(r?.source || '') === 'police_accident')) return 'accident'
  if (rows.some(r => String(r?.source || '') === 'police_saisie')) return 'saisie'
  return null
}

// ── Libellés des lignes ─────────────────────────────────────────────────────
// « Prise en charge (KAZE) — bdc98a74-… » → « Prise en charge » ; « Treuil dégât (TD) » → « Treuil dégât ».
export function nettoyerLibelle(name: string): string {
  return String(name || '')
    .replace(/\s+—\s+(REL-)?[0-9a-f]{8}-[0-9a-f-]{27,}\s*$/i, '')
    .replace(/\s+—\s+[A-Z0-9][A-Z0-9-]{6,}\s*$/, '')          // n° de mission / dossier en fin de libellé
    .replace(/\s*\((?:[A-Z][A-Z0-9_]{1,11})\)\s*$/, '')          // code tarif entre parenthèses
    .replace(/\s*\((KAZE|TOURING|VAB|AXA|MONDIAL|ETHIAS|PV_ASSISTANCE|IMA|ALLIANZ|SIA_COUVERT)\)/i, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]️?\s*/gu, '')
    .trim()
}
export function nettoyerLignes(lines: QuoteLine[]): QuoteLine[] {
  return lines.map(l => ({ ...l, name: nettoyerLibelle(l.name) }))
}

// ── Dépôts : celui de la zone de parc ─────────────────────────────────────
async function depotsParZone(sb: any): Promise<Record<string, { name: string; street: string }>> {
  const [{ data: z }, { data: d }] = await Promise.all([sb.from('parc_zones').select('key, depot_id'), sb.from('depots').select('id, name, address')])
  const byId = Object.fromEntries((d || []).map((x: any) => [x.id, x]))
  const out: Record<string, { name: string; street: string }> = {}
  for (const r of z || []) { const dep = byId[r.depot_id]; if (dep) out[r.key] = { name: dep.name, street: String(dep.address || '').split(',')[0].trim() } }
  return out
}

const DEPOT_TXT = /verviers d[ée]pannage|cit[ée] ?22|lefin\b|ti[eè]ge ?107/i
const titre = (x: string) => x.toLowerCase().replace(/(^|[\s'’-])([a-zà-ÿ])/g, (_, a, b) => a + b.toUpperCase())
/** Localité d'une adresse : « Rue de l'Esplanade, SPRIMONT, 4141, BEL » → « Sprimont ». */
export function localite(addr?: string | null): string {
  const a = String(addr || '').trim(); if (!a) return ''
  const parts = a.split(',').map(x => x.trim()).filter(x => x && !/^(bel|belgique|belgium|be|fra?|france|nld?|pays-bas|deu?|allemagne|lux?)$/i.test(x))
  for (const p of parts) { const m = p.match(/\b\d{4,5}\s*(?:[A-Z]{2}\s+)?([A-Za-zÀ-ÿ'’ -]{2,})$/); if (m) return titre(m[1].trim()) }
  const i = parts.findIndex(p => /^\d{4,5}$/.test(p)); if (i > 0) return titre(parts[i - 1])
  return titre(parts.length > 1 ? parts[parts.length - 1].replace(/^\d{4,5}\s*/, '') : parts[0])
}

export interface Etape { n: number; mission_id: string; kind: DossierLeg['kind'] | 'reprise'; titre: string; date: string; quoi: string; cote: string }

/** Étapes du dossier, dans l'ordre, avec un numéro (repris dans les sections de la facture). */
export async function etapesDossier(sb: any, d: Dossier, rowById: Record<string, any>): Promise<Etape[]> {
  const zones = await depotsParZone(sb)
  const legs = d.legs.filter(l => l.kind !== 'out')
  const rows = (await sb.from('incoming_missions').select('*').in('id', legs.map(l => l.mission_id).filter(id => !rowById[id]))).data || []
  for (const r of rows) rowById[r.id] = r
  const root = rowById[d.root_id] || {}
  const gardZone = legs.filter(l => l.kind === 'gard').map(l => rowById[l.mission_id]?.parc_zone_key).find(Boolean) || root.parc_zone_key
  const depotDe = (m: any) => { const k = m?.parc_zone_key || gardZone; const z = k ? zones[k] : null; return z ? `notre dépôt de ${z.name}, ${z.street}` : 'notre dépôt' }
  const out: Etape[] = []
  for (const leg of legs) {
    const m = rowById[leg.mission_id] || {}
    if (leg.kind === 'rem') {
      const police = isPolice(m)
      const t = String(m.mission_type || '').toLowerCase()
      const surPlace = /d[ée]pannage|reparation|dsp|trajet_vide/.test(t)
      const auDepot = !!m.parked_at || !m.destination_address || DEPOT_TXT.test(String(m.destination_address)) || (legs.some(l => l.kind === 'gard') && legs.indexOf(leg) < legs.findIndex(l => l.kind === 'gard'))
      const vers = surPlace ? '' : auDepot ? ` → ${depotDe(m)}` : ` → ${m.destination_address}`
      out.push({ n: 0, mission_id: leg.mission_id, kind: 'rem', titre: police ? 'Appel police' : surPlace ? 'Dépannage' : 'Remorquage', date: day(m.intervention_date || m.received_at),
        quoi: `${police && /accident/i.test(String(m.source)) ? 'Accident ' : ''}${DEPOT_TXT.test(String(m.incident_address || '')) ? depotDe(m) : (m.incident_address || '')}${vers}`, cote: police ? String(m.police_zone || '') : '' })
      // Appel police repris par une assistance (lien assisteur sur la facture).
      const assist = leg.billed_to_name && !/parquet|frais de justice|police|client divers/i.test(String(leg.billed_to_name))
      if (police && assist && (d.dossier_number || '').match(/[A-Z0-9]{6,}/)) {
        const ref = String(d.dossier_number).split(/\s*\/\s*/).map(s => s.trim()).find(s => !/^(ACC|SNC|SAISIE)-/i.test(s)) || ''
        out.push({ n: 0, mission_id: leg.mission_id, kind: 'reprise', titre: `Reprise par ${leg.billed_to_name}`, date: day(m.intervention_date || m.received_at), quoi: `${ref ? `Mission ${ref.replace(/([BF]\d[0-9A-Z]\d{6})[A-Z]{2}\b/, '$1')} : ` : ''}appel police pris en charge par l’assistance`, cote: '' })
      }
    } else if (leg.kind === 'gard') {
      const from = m.parked_at || leg.started_at, to = m.parc_exit_at || leg.ended_at
      const nuits = from && to ? nightsBetween(from, to) : null
      const flat = Number(root.storage_flat_htva) > 0 || Number(m.storage_flat_htva) > 0
      const offert = !flat && (!!root.storage_waived || !!m.storage_waived || /offert|aucune nuit facturable|gratuit/i.test(String(leg.nothing_to_bill || '')))
      const z = m.parc_zone_key ? zones[m.parc_zone_key] : (root.parc_zone_key ? zones[root.parc_zone_key] : null)
      const dates = from && to && day(from) !== day(to) ? `${day(from).slice(0, 5)} → ${day(to)}` : day(from || to)
      out.push({ n: 0, mission_id: leg.mission_id, kind: 'gard', titre: 'Au parc', date: dates,
        quoi: `Dépôt de ${z?.name || '—'}${nuits === 0 ? ' · aucune nuit' : nuits ? ` · ${nuits} nuit${nuits > 1 ? 's' : ''}` : ''}`, cote: flat ? 'compris dans le forfait' : offert && nuits ? 'gardiennage offert' : '' })
    } else if (leg.kind === 'rel') {
      out.push({ n: 0, mission_id: leg.mission_id, kind: 'rel', titre: 'Relivraison', date: day(m.loaded_at || m.completed_at || m.intervention_date || m.received_at),
        quoi: `Notre dépôt → ${m.destination_address || m.destination_name || ''}`, cote: '' })
    }
  }
  out.forEach((e, i) => { e.n = i + 1 })
  return out
}

/** Libellé court d'une section de facture, numéroté comme le parcours. */
export function libelleSection(e: Etape | undefined, fallback: string): string {
  if (!e) return nettoyerLibelle(fallback)
  if (e.kind === 'gard') return `${e.n} · Gardiennage ${e.date.includes('→') ? `du ${e.date.replace(' → ', ' au ')}` : `le ${e.date}`}`
  const [de, vers] = e.quoi.replace(/^Accident /, '').split('→').map(x => x.trim())
  const lieu = (x?: string) => /^notre dépôt/i.test(x || '') ? 'notre dépôt' : localite(x)
  if (e.kind === 'rel') return `${e.n} · Relivraison de notre dépôt à ${localite(vers)}`
  if (e.titre === 'Dépannage') return `${e.n} · Dépannage à ${localite(de)}`
  return `${e.n} · ${e.titre === 'Appel police' ? 'Remorquage sur appel police' : 'Remorquage'}, de ${lieu(de)} à ${lieu(vers)}`
}

export function parcoursHtml(etapes: Etape[]): string {
  const td = 'border:0;border-bottom:1px solid #eee;padding:6px;vertical-align:top;font-size:11px'
  const rows = etapes.map(e => `<tr><td style="${td};width:26px"><span style="display:inline-block;width:18px;height:18px;line-height:18px;border-radius:9px;background:#af1d26;color:#fff;text-align:center;font-weight:bold;font-size:10px">${e.n}</span></td>`
    + `<td style="${td};width:150px"><b>${esc(e.titre)}</b><br/><span style="color:#666">${esc(e.date)}</span></td>`
    + `<td style="${td}">${esc(e.quoi.charAt(0).toUpperCase() + e.quoi.slice(1))}</td><td style="${td};width:150px;color:#666;text-align:right">${esc(e.cote)}</td></tr>`).join('')
  return `<table class="table-borderless" style="width:100%;border-collapse:collapse;margin:0">${rows}</table>`
}

// ── Photos : 2-3 vues d'ensemble choisies par l'IA légère ─────────────────
const PROMPT_PHOTOS = 'Photos prises par un chauffeur de dépannage, imprimées en petit sur une facture. Choisis au maximum 3 photos montrant une VUE D’ENSEMBLE du véhicule dépanné : voiture entière ou presque, NETTE, BIEN EXPOSÉE (pas sombre, pas surexposée, pas de reflet ni de flash qui masque le véhicule), angles différents. Exclus : documents, cartes d’identité, plaques de VIN, compteurs, détails, photos floues, de nuit illisibles ou sans véhicule. Mieux vaut UNE seule bonne photo, ou aucune, qu’une photo médiocre. Réponds uniquement en JSON : {"choix":[numéros]}'

export async function vignettesPhotos(urls: string[]): Promise<string | null> {
  const list = urls.filter(Boolean).slice(0, 12)
  if (!list.length) return null
  const sharp = (await import('sharp')).default
  const imgs: { small: string; thumb: string }[] = []
  for (const u of list) {
    try {
      const buf = Buffer.from(await (await fetch(u, { cache: 'no-store' })).arrayBuffer())
      const base = sharp(buf).rotate()
      const small = (await base.clone().resize(512, 512, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer()).toString('base64')
      const thumb = (await base.clone().resize(300, 300, { fit: 'inside' }).jpeg({ quality: 72 }).toBuffer()).toString('base64')
      imgs.push({ small, thumb })
    } catch { /* photo illisible : ignorée */ }
  }
  if (!imgs.length) return null
  const { aiClient } = await import('@/lib/ai/usage')
  const { ANTHROPIC_CHEAP_MODELS, createWithModelFallback } = await import('@/lib/anthropic-model')
  const content: any[] = []
  imgs.forEach((im, i) => { content.push({ type: 'text', text: `Photo ${i}` }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: im.small } }) })
  content.push({ type: 'text', text: PROMPT_PHOTOS })
  const r = await createWithModelFallback(aiClient('facture/photos'), ['claude-haiku-5-5', ...ANTHROPIC_CHEAP_MODELS], { max_tokens: 2000, messages: [{ role: 'user', content }] })
  const txt = String((r.content || []).find((c: any) => c.type === 'text')?.text || '')
  const m = txt.match(/\{[\s\S]*\}/); if (!m) return null
  const choix: number[] = (JSON.parse(m[0]).choix || []).map(Number).filter((i: number) => Number.isInteger(i) && imgs[i]).slice(0, 3)
  if (!choix.length) return null
  const cells = choix.map(i => `<td style="border:0;padding:0 8px 0 0;vertical-align:top"><img src="data:image/jpeg;base64,${imgs[i].thumb}" style="height:95px;border:1px solid #ccc;border-radius:4px"/></td>`).join('')
  return `<table class="table-borderless" style="border-collapse:collapse;margin:0"><tr>${cells}</tr></table>`
}

/** Après la création de la facture : champs enrichis + VIN sur le véhicule. Jamais bloquant. */
export async function enrichirFacture(input: { sb: any; moveId: number; etapes: Etape[]; rows: any[]; clientName: string; fleetVehicleId: number | null }): Promise<string[]> {
  const notes: string[] = []
  const { odooRpc } = await import('@/lib/odoo')
  const root = input.rows[0] || {}
  const clientFinal = (() => {
    const n = String([root, ...input.rows].map(r => r?.client_name).find(x => x && !/^#|livraison|xxxx/i.test(String(x))) || '').trim()
    if (!n || /^#|livraison|xxxx/i.test(n) || n.toLowerCase() === String(input.clientName || '').toLowerCase()) return null
    return n.replace(/\b([a-zà-ÿ])([a-zà-ÿ]*)/gi, (_, a, b) => a.toUpperCase() + b.toLowerCase())
  })()
  const vals: Record<string, any> = {
    x_vd_parcours: input.etapes.length ? parcoursHtml(input.etapes) : false,
    x_vd_sinistre: sinistreCourt(input.rows) || false,
    x_vd_client_final: clientFinal || false,
  }
  try {
    const urls = input.rows.flatMap(r => Array.isArray(r.driver_photos) ? r.driver_photos : [])
    const { withAiContext } = await import('@/lib/ai/usage')
    vals.x_vd_photos = (await withAiContext({ declencheur: 'facture:photos' }, () => vignettesPhotos(urls))) || false
  } catch (e: any) { notes.push(`photos non ajoutées : ${e?.message || e}`) }
  await odooRpc('account.move', 'write', [[input.moveId], vals])
  // VIN de la fiche → véhicule de l'ERP (le modèle l'imprime depuis là).
  try {
    const vin = input.rows.map(r => String(r.vehicle_vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '')).find(v => /^[A-HJ-NPR-Z0-9]{17}$/.test(v))
    if (vin && input.fleetVehicleId) {
      const [fv]: any[] = await odooRpc('fleet.vehicle', 'read', [[input.fleetVehicleId]], { fields: ['vin_sn'] })
      if (fv && !fv.vin_sn) await odooRpc('fleet.vehicle', 'write', [[input.fleetVehicleId], { vin_sn: vin }])
    }
  } catch (e: any) { notes.push(`VIN non recopié : ${e?.message || e}`) }
  return notes
}
