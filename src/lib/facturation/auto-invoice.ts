// src/lib/facturation/auto-invoice.ts
//
// Facturation AUTOMATIQUE par source + type d'intervention.
// À la clôture d'une mission (to_invoice), si la règle source+type est activée
// ET que les conditions sont réunies, on crée la facture brouillon Odoo.
//
// Conditions STRICTES (Olivier 2026-07-27) :
//   - type = DSP ou REM uniquement (pas trajet à vide, pas transport, pas REL)
//   - mission SÈCHE : pas de parent ni d'enfant (relivraison) → pas de combiné
//   - un VRAI tarif doit être présent (sinon on laisse en manuel)
//
// Config stockée dans app_settings.auto_invoice_rules (TEXTE JSON) :
//   { "<source>": { "dsp": true, "rem": false }, ... }

import { isDsp, isRemorquage, isTrajetVide, isTransport, isRelivraison, isRemRel } from '@/lib/missions/mission-types'

// Types activables individuellement par source (Olivier 2026-07-27).
export type AutoInvoiceType = 'dsp' | 'rem' | 'trajet_vide' | 'transport' | 'relivraison'
export const AUTO_INVOICE_TYPES: { key: AutoInvoiceType; label: string }[] = [
  { key: 'dsp',         label: 'DSP' },
  { key: 'rem',         label: 'REM' },
  { key: 'trajet_vide', label: 'Trajet vide' },
  { key: 'transport',   label: 'Transport' },
  { key: 'relivraison', label: 'Relivraison' },
]
export type AutoInvoiceRules = Record<string, Partial<Record<AutoInvoiceType, boolean>>>

const RULES_KEY = 'auto_invoice_rules'

/** Lit les règles (app_settings.value = TEXTE JSON → toujours parser). */
export async function getAutoInvoiceRules(sb: any): Promise<AutoInvoiceRules> {
  try {
    const { data } = await sb.from('app_settings').select('value').eq('key', RULES_KEY).maybeSingle()
    const raw = data?.value
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return (parsed && typeof parsed === 'object') ? parsed as AutoInvoiceRules : {}
  } catch { return {} }
}

/** Écrit les règles. */
export async function setAutoInvoiceRules(sb: any, rules: AutoInvoiceRules): Promise<void> {
  await sb.from('app_settings').upsert({ key: RULES_KEY, value: rules }, { onConflict: 'key' })
}

const DELAY_KEY = 'auto_invoice_delay_hours'
/** Délai (heures) après clôture avant facturation auto. Défaut 2h. */
export async function getAutoInvoiceDelayHours(sb: any): Promise<number> {
  try {
    const { data } = await sb.from('app_settings').select('value').eq('key', DELAY_KEY).maybeSingle()
    const raw = data?.value
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : 2
  } catch { return 2 }
}
export async function setAutoInvoiceDelayHours(sb: any, hours: number): Promise<void> {
  await sb.from('app_settings').upsert({ key: DELAY_KEY, value: hours }, { onConflict: 'key' })
}

/** Type canonique activable d'une mission, ou null si hors périmètre.
 *  On exclut UNIQUEMENT le type combiné REM+REL (qui n'est pas une mission sèche). */
export function autoInvoiceType(missionType: string | null | undefined): AutoInvoiceType | null {
  if (isRemRel(missionType))     return null
  if (isDsp(missionType))        return 'dsp'
  if (isRemorquage(missionType)) return 'rem'
  if (isTrajetVide(missionType)) return 'trajet_vide'
  if (isTransport(missionType))  return 'transport'
  if (isRelivraison(missionType))return 'relivraison'
  return null
}

export interface AutoInvoiceCheck {
  eligible: boolean
  type?: AutoInvoiceType
  reason?: string
}

/**
 * Éligibilité SYNCHRONE (sans I/O) : type + règle + « sèche » côté parent.
 * Le contrôle « pas d'enfant relivraison » et « vrai tarif présent » se fait
 * dans le déclencheur (async) car ils nécessitent des requêtes.
 */
export function checkAutoInvoiceEligible(
  mission: { source?: string | null; mission_type?: string | null; parent_mission_id?: string | null },
  rules: AutoInvoiceRules,
): AutoInvoiceCheck {
  const type = autoInvoiceType(mission.mission_type)
  if (!type) return { eligible: false, reason: 'type hors périmètre (DSP/REM only)' }
  if (mission.parent_mission_id) return { eligible: false, type, reason: 'mission liée (combinée)' }
  const src = String(mission.source || '')
  const enabled = !!rules[src]?.[type]
  if (!enabled) return { eligible: false, type, reason: `règle ${src}/${type} désactivée` }
  return { eligible: true, type }
}
