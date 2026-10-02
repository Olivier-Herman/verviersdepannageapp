// src/lib/notifications/sound-families.ts
//
// Sons des notifications iPhone (Olivier 01-02/10/2026) : 9 familles × 9 propositions —
// 3 sans voix « 1/2/3 », 2 avec voix « v1/v2 » (dans l'app depuis le build 30), et la
// version fun : 2 sans voix « f1/f2 », 2 avec voix « fv1/fv2 » (dans l'app à partir du
// build 35). Fichiers vd_<famille>_<choix>.caf. Chaque type de notification appartient
// à une famille ; le son retenu par famille se choisit dans /admin/sons-notifications
// (app_settings « notif_sons », JSON texte). Build < 30 : fichier absent → son par défaut.

import { createAdminClient } from '@/lib/supabase'

export const SOUND_CHOICES = ['1', '2', '3', 'v1', 'v2', 'f1', 'f2', 'fv1', 'fv2'] as const
/** Version fun : présente dans l'app iPhone à partir du build 35. */
export const FUN_CHOICES = ['f1', 'f2', 'fv1', 'fv2']
export type SoundChoice = typeof SOUND_CHOICES[number]

export interface SoundFamily { key: string; label: string; desc: string; types: string[] }

export const SOUND_FAMILIES: SoundFamily[] = [
  { key: 'mission', label: 'Mission', desc: 'Nouvelle mission, mission attribuée, Momo Market.',
    types: ['new_mission_received', 'mission_assigned_manual', 'auto_dispatch_dispo_request', 'market_new_mission', 'market_claimed', 'kaze_accept_manual', 'axa_new_to_validate'] },
  { key: 'nuit', label: 'Garde de nuit', desc: 'Proposition de nuit au 1er départ / à la réserve, garde non couverte, échanges de garde.',
    types: ['market_proposal', 'market_proposal_update', 'reserve_notif_toggled', 'garde_uncovered', 'garde_swap_requested', 'garde_swap_decided'] },
  { key: 'siabis', label: 'Siabis', desc: 'Demande et décision « couvert » Siabis.',
    types: ['siabis_couvert_request', 'siabis_couvert_decided'] },
  { key: 'escalade', label: 'Urgent / escalade', desc: 'Appel d’escalade, mission refusée ou sans réponse, annulation par l’assistance, connexion perdue.',
    types: ['escalation_call', 'auto_dispatch_refused', 'auto_dispatch_timeout', 'fiche_ouverte_dispatch', 'mission_cancelled_by_insurer', 'kaze_cancelled_after_start', 'axa_cancelled_after_start', 'touring_cancelled', 'garage_cancel_request', 'comex_login_failed', 'axa_poll_down', 'email_parse_error'] },
  { key: 'check', label: 'Contrôle véhicule / rappel', desc: 'Contrôle véhicule, code personnel, fiche restée ouverte.',
    types: ['check_vehicule_due', 'pin_recall_check', 'pin_setup_reminder', 'fiche_ouverte_rappel'] },
  { key: 'parc', label: 'Parc', desc: 'Vérification du parc, dérogation de restitution, expert, saisie.',
    types: ['verification_parc', 'restitution_derogation_requested', 'saisie_facturation', 'expert_access', 'expert_visit'] },
  { key: 'repare', label: 'Réparé / rétabli', desc: 'Ce qui était en panne refonctionne (connexion AXA rétablie…).',
    types: ['axa_poll_up'] },
  { key: 'talkie', label: 'Talkie', desc: '« X te parle ».',
    types: ['talkie_message'] },
  { key: 'info', label: 'Information', desc: 'Tout le reste : paiements, congés, questions, courrier, annonces…', types: [] },
]

const SETTING_KEY = 'notif_sons'
let cache: { at: number; v: Record<string, SoundChoice> } | null = null

export function familyOf(type: string | undefined | null): string {
  return SOUND_FAMILIES.find(f => f.types.includes(String(type || '')))?.key || 'info'
}

export async function loadSoundChoices(fresh = false): Promise<Record<string, SoundChoice>> {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache.v
  const out: Record<string, SoundChoice> = {}
  try {
    const { data } = await createAdminClient().from('app_settings').select('value').eq('key', SETTING_KEY).maybeSingle()
    const raw = data?.value ? JSON.parse(String(data.value)) : {}
    for (const f of SOUND_FAMILIES) out[f.key] = (SOUND_CHOICES as readonly string[]).includes(raw?.[f.key]) ? raw[f.key] : '1'
  } catch { for (const f of SOUND_FAMILIES) out[f.key] = '1' }
  cache = { at: Date.now(), v: out }
  return out
}

export async function saveSoundChoices(v: Record<string, string>): Promise<Record<string, SoundChoice>> {
  const clean: Record<string, SoundChoice> = {}
  for (const f of SOUND_FAMILIES) clean[f.key] = (SOUND_CHOICES as readonly string[]).includes(v[f.key]) ? v[f.key] as SoundChoice : '1'
  await createAdminClient().from('app_settings').upsert({ key: SETTING_KEY, value: JSON.stringify(clean) }, { onConflict: 'key' })
  cache = null
  return clean
}

/** Fichier son iPhone du type de notification (ex. vd_mission_v1.caf). */
export async function iosSoundFor(type: string | undefined | null): Promise<string> {
  const fam = familyOf(type)
  const choice = (await loadSoundChoices())[fam] || '1'
  return `vd_${fam}_${choice}.caf`
}
