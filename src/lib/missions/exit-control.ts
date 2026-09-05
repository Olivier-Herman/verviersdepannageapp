// src/lib/missions/exit-control.ts
//
// CONTRÔLE DE SORTIE des épaves gérées par un bureau d'expertise.
// Olivier 2026-09-05 (après le vol d'une épave rendue sans vérification).
//
// Règle métier :
//   - Tant qu'AUCUN expert n'a vu le véhicule : aucun blocage, la fiche
//     Police – Accident suit la restitution normale.
//   - Dès qu'un expert a enregistré son passage (registre des visites, motif
//     « expert » ou bureau renseigné), la fiche est ARMÉE : la sortie du parc
//     est bloquée tant que la checklist n'est pas complète.
//   - Chemin de sortie choisi par le bureau / l'expert (ou, en attendant
//     l'espace expert, encodé par le bureau fourrière « sur instruction de … ») :
//       'informex'   → bon Informex décodé + identité concordante + CMR si
//                      transporteur + attestation signée
//       'autre'      → destination déclarée + identité + attestation signée
//       'assistance' → le dossier est repris par une assistance : la mission
//                      d'assistance vaut demande officielle de transfert
//   - Sortie forcée possible par tout le monde : motif + PIN personnel, tracée.
//
// Ce module est la SEULE source de vérité : toutes les routes qui font sortir
// un véhicule du parc appellent assertExitAllowed() avant d'agir.

export const EXIT_CONTROL_SOURCES = ['police_accident']

// Sources « police / privé » : une fille REL portant une AUTRE source est une
// reprise par une assistance (Touring, VAB, Ethias, IMA…).
const NON_ASSISTANCE_PREFIXES = ['police_', 'prive', 'sia_couvert', 'tgr']

export type ExitPath = 'informex' | 'autre' | 'assistance'
export type IdentityRole = 'buyer' | 'mandate' | 'transporter'

export interface ExitChecks {
  path:        boolean
  informex:    boolean
  identity:    boolean
  cmr:         boolean
  attestation: boolean
}

export interface ExitControlState {
  armed:        boolean
  allowed:      boolean
  forced:       boolean
  reason:       string | null
  control:      any | null
  documents:    any[]
  checks:       ExitChecks
  requires:     { informex: boolean; cmr: boolean; attestation: boolean }
  expertVisits: any[]
  pendingTokens: any[]
}

export function isExitControlSource(source?: string | null): boolean {
  return !!source && EXIT_CONTROL_SOURCES.includes(source)
}

const isAssistanceSource = (source?: string | null) =>
  !!source && !NON_ASSISTANCE_PREFIXES.some(p => source.startsWith(p))

/** Libellés des motifs de visite « expert » (catalogue paramétrable). */
async function expertMotifLabels(sb: any): Promise<string[]> {
  const { data } = await sb.from('visitor_motifs').select('label').eq('is_expert', true)
  return (data || []).map((m: any) => String(m.label || '').trim().toLowerCase()).filter(Boolean)
}

export function visitIsExpert(visit: any, labels: string[]): boolean {
  if (!visit) return false
  if (visit.expert_bureau) return true
  const motifs: string[] = Array.isArray(visit.motifs) ? visit.motifs : []
  return motifs.some(m => labels.includes(String(m || '').trim().toLowerCase()))
}

export async function listExpertVisits(sb: any, missionId: string): Promise<any[]> {
  const [labels, { data: visits }] = await Promise.all([
    expertMotifLabels(sb),
    sb.from('mission_visitors')
      .select('id, visited_at, first_name, last_name, motifs, expert_bureau, source')
      .eq('mission_id', missionId)
      .order('visited_at', { ascending: true }),
  ])
  return (visits || []).filter((v: any) => visitIsExpert(v, labels))
}

/**
 * Arme la fiche à partir d'une visite d'expert (appelé à l'enregistrement
 * d'une visite, comptoir ou manuel). Idempotent : une fiche déjà armée ne
 * bouge pas (le premier passage fait foi).
 */
export async function armExitControlFromVisit(sb: any, missionId: string, visit: any): Promise<boolean> {
  const { data: mission } = await sb.from('incoming_missions')
    .select('id, source, status').eq('id', missionId).maybeSingle()
  if (!mission || !isExitControlSource(mission.source)) return false
  const labels = await expertMotifLabels(sb)
  if (!visitIsExpert(visit, labels)) return false

  const { data: existing } = await sb.from('mission_exit_control')
    .select('mission_id').eq('mission_id', missionId).maybeSingle()
  if (existing) return true

  const armedAt = visit.visited_at || new Date().toISOString()
  const { error } = await sb.from('mission_exit_control').insert({
    mission_id:        missionId,
    armed_at:          armedAt,
    armed_by_visit_id: visit.id || null,
    expert_bureau:     visit.expert_bureau || null,
  })
  if (error) { console.error('[exit-control] arm échec:', error.message); return false }

  const who = [visit.first_name, visit.last_name].filter(Boolean).join(' ') || 'un expert'
  await sb.from('mission_logs').insert({
    mission_id: missionId, action: 'exit_control_armed',
    notes: `🔒 Contrôle de sortie activé : passage de ${who}${visit.expert_bureau ? ` (${visit.expert_bureau})` : ''}. Sortie bloquée jusqu'à checklist complète.`,
    metadata: { visit_id: visit.id || null, expert_bureau: visit.expert_bureau || null },
  }).then(() => {}, () => {})
  await sb.from('mission_remarks').insert({
    mission_id: missionId,
    text: `🔒 Véhicule géré par un bureau d'expertise${visit.expert_bureau ? ` (${visit.expert_bureau})` : ''} depuis le passage de ${who} : sortie du parc soumise au contrôle (bon Informex, identité, attestation signée).`,
  }).then(() => {}, () => {})
  return true
}

export type ExitStep = 'path' | 'informex' | 'identity' | 'cmr' | 'attestation'
export const EXIT_STEPS: ExitStep[] = ['path', 'informex', 'identity', 'cmr', 'attestation']
export const EXIT_STEP_LABELS: Record<ExitStep, string> = {
  path:        'Chemin de sortie',
  informex:    'Bon Informex',
  identity:    'Identité de la personne présente',
  cmr:         'CMR du transporteur',
  attestation: "Attestation d'enlèvement signée",
}

/** Une étape passée (motif + PIN) compte comme faite, mais reste tracée. */
const skipped = (control: any, step: ExitStep) => !!control?.skips?.[step]

export function computeChecks(control: any): { checks: ExitChecks; requires: ExitControlState['requires'] } {
  const path: ExitPath | null = control?.path || null
  const requires = {
    informex:    path === 'informex',
    cmr:         control?.identity_role === 'transporter',
    attestation: path !== 'assistance',
  }
  const checks: ExitChecks = {
    path:        !!path || skipped(control, 'path'),
    informex:    !requires.informex || !!control?.informex_qr_raw || skipped(control, 'informex'),
    identity:    path === 'assistance' || !!control?.identity || skipped(control, 'identity'),
    cmr:         !requires.cmr || !!control?.cmr || skipped(control, 'cmr'),
    attestation: !requires.attestation || !!control?.attestation_signed_at || skipped(control, 'attestation'),
  }
  return { checks, requires }
}

function blockedReason(control: any, checks: ExitChecks): string | null {
  if (!checks.path)        return 'Chemin de sortie non choisi (Informex, autre sortie ou reprise par une assistance).'
  if (!checks.informex)    return 'Bon Informex non scanné.'
  if (!checks.identity)    return 'Identité de la personne présente non enregistrée.'
  if (!checks.cmr)         return 'CMR du transporteur non photographié.'
  if (!checks.attestation) return "Attestation d'enlèvement non signée."
  return null
}

/**
 * État complet du contrôle pour une fiche. Arme à la volée si un passage
 * d'expert existe déjà sans ligne de contrôle (visites antérieures au module).
 * Détecte aussi la reprise par une assistance (fille REL sur une source
 * assistance) et fige le chemin 'assistance'.
 */
export async function getExitControlState(sb: any, missionId: string): Promise<ExitControlState> {
  const empty = (): ExitControlState => ({
    armed: false, allowed: true, forced: false, reason: null, control: null, documents: [],
    checks: { path: true, informex: true, identity: true, cmr: true, attestation: true },
    requires: { informex: false, cmr: false, attestation: false },
    expertVisits: [], pendingTokens: [],
  })

  const { data: mission } = await sb.from('incoming_missions')
    .select('id, source, status, vehicle_plate, vehicle_vin').eq('id', missionId).maybeSingle()
  if (!mission || !isExitControlSource(mission.source)) return empty()

  const expertVisits = await listExpertVisits(sb, missionId)
  let { data: control } = await sb.from('mission_exit_control').select('*').eq('mission_id', missionId).maybeSingle()

  if (!control) {
    if (!expertVisits.length) return { ...empty(), expertVisits }
    await armExitControlFromVisit(sb, missionId, expertVisits[0])
    const r = await sb.from('mission_exit_control').select('*').eq('mission_id', missionId).maybeSingle()
    control = r.data
    if (!control) return { ...empty(), expertVisits }
  }

  // Reprise par une assistance : fille REL sur une source assistance.
  if (!control.path) {
    const { data: kids } = await sb.from('incoming_missions')
      .select('id, source, external_id, status')
      .eq('parent_mission_id', missionId)
      .not('status', 'in', '("cancelled","ignored")')
    const assist = (kids || []).find((k: any) => isAssistanceSource(k.source))
    if (assist) {
      const now = new Date().toISOString()
      await sb.from('mission_exit_control').update({
        path: 'assistance', path_chosen_at: now, path_chosen_by_kind: 'system',
        path_chosen_by_name: assist.source, path_note: `Reprise par une assistance (${assist.external_id || assist.id})`,
        assistance_mission_id: assist.id, updated_at: now,
      }).eq('mission_id', missionId)
      await sb.from('mission_logs').insert({
        mission_id: missionId, action: 'exit_control_path',
        notes: `🔓 Contrôle de sortie : dossier repris par une assistance (${assist.source}, ${assist.external_id || assist.id}) — la demande d'assistance vaut demande de transfert.`,
        metadata: { path: 'assistance', assistance_mission_id: assist.id },
      }).then(() => {}, () => {})
      const r = await sb.from('mission_exit_control').select('*').eq('mission_id', missionId).maybeSingle()
      control = r.data || control
    }
  }

  const [{ data: documents }, { data: tokens }] = await Promise.all([
    sb.from('mission_documents')
      .select('id, kind, file_name, mime_type, file_size, ocr, qr_raw, created_at, uploaded_by')
      .eq('mission_id', missionId).order('created_at', { ascending: false }),
    sb.from('capture_tokens').select('id, kind, created_at, expires_at, used_at')
      .eq('mission_id', missionId).is('used_at', null).gt('expires_at', new Date().toISOString()),
  ])

  const { checks, requires } = computeChecks(control)
  const forced  = !!control.forced_at
  const complete = Object.values(checks).every(Boolean)
  const allowed = forced || complete
  return {
    armed: true, allowed, forced,
    reason: allowed ? null : blockedReason(control, checks),
    control, documents: documents || [], checks, requires, expertVisits,
    pendingTokens: tokens || [],
  }
}

/**
 * Garde-fou serveur : à appeler avant TOUTE sortie du parc.
 * via 'relivraison' : c'est NOTRE chauffeur qui transporte (pas de personne
 * extérieure au comptoir) → il suffit que le bureau ait choisi « autre
 * sortie » ou que le dossier soit repris par une assistance.
 */
export async function assertExitAllowed(
  sb: any, missionId: string, opts: { via?: 'restitution' | 'relivraison' } = {},
): Promise<{ ok: true; state: ExitControlState } | { ok: false; error: string; state: ExitControlState }> {
  const state = await getExitControlState(sb, missionId)
  if (state.allowed) return { ok: true, state }
  if (opts.via === 'relivraison' && ['autre', 'assistance'].includes(state.control?.path || '')) return { ok: true, state }
  return {
    ok: false,
    state,
    error: `🔒 Sortie bloquée — véhicule géré par un bureau d'expertise. ${state.reason || ''} Complète le contrôle de sortie sur la fiche (ou sortie forcée : motif + PIN).`.trim(),
  }
}

/** Concordance plaque / châssis entre le bon Informex lu et la fiche. */
export function informexMatch(doc: any, mission: { vehicle_plate?: string | null; vehicle_vin?: string | null }) {
  const norm = (s?: string | null) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const plateDoc = norm(doc?.plate), plateMission = norm(mission.vehicle_plate)
  const vinDoc   = norm(doc?.vin),   vinMission   = norm(mission.vehicle_vin)
  return {
    plate: plateDoc && plateMission ? plateDoc === plateMission : null,
    vin:   vinDoc && vinMission     ? vinDoc === vinMission     : null,
  }
}
