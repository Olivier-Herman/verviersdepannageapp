'use client'
// src/components/dispatch/Flux2ClosureCard.tsx
//
// Bloc « Clôture chauffeur » de la fiche dispatch (Olivier 2026-08-12).
//
// Tout ce que le chauffeur a renseigné à la clôture, d'un seul coup d'œil :
// ce qu'il a fait, ce qu'il a constaté, où sont le véhicule et la clé. Le
// dispatch n'a plus à ouvrir l'historique pour reconstituer une intervention.
//
// Aucun appel réseau : la fiche et ses journaux sont déjà chargés par la page.
// Le bloc ne s'affiche que si une clôture flux 2 a bien eu lieu.

import { endMissionLabel } from '@/lib/touring/close-presets'
import { labelOf, PANNE_CAUSE, PANNE_DESC, PANNE_RESULT } from '@/lib/touring/close-referentials'

interface AnyLog { action: string; notes: string | null; created_at: string; metadata?: any; actor?: { name: string } | null }

// Le dispatch ne parle pas « fin 00 » ni « 06→07 » : on traduit tout (Olivier
// 2026-08-12). Les codes bruts restent accessibles en infobulle, pour le jour où
// quelqu'un doit les recouper avec l'écran de Touring.
const COMEX_STATUS: Record<string, string> = {
  '03': 'à valider', '04': 'acceptée', '05': 'en route',
  '06': 'sur place', '07': 'terminée',
}
const statusWords = (before?: string | null, after?: string | null) => {
  const a = before ? COMEX_STATUS[before] || `statut ${before}` : null
  const b = after ? COMEX_STATUS[after] || `statut ${after}` : null
  if (a && b && a !== b) return `dossier passé de « ${a} » à « ${b} »`
  if (b) return `dossier « ${b} »`
  return null
}
const codeWords = (c?: any) => c && (c.cause || c.desc || c.result)
  ? [labelOf(PANNE_CAUSE, String(c.cause || '')), labelOf(PANNE_DESC, String(c.desc || '')), labelOf(PANNE_RESULT, String(c.result || ''))]
      .filter(Boolean).join(' · ')
  : null

const OUTCOME_LABELS: Record<string, { label: string; tone: 'green' | 'amber' | 'slate' }> = {
  dsp:       { label: 'Dépannage réussi',          tone: 'green' },
  rem2dsp:   { label: 'Finalement réparé',          tone: 'green' },
  rem:       { label: 'Transformé en remorquage',   tone: 'amber' },
  rem_vr:    { label: 'Remorquage + VR',            tone: 'amber' },
  delivered: { label: 'Véhicule livré',             tone: 'green' },
  park:      { label: 'Mise en parc',               tone: 'amber' },
  dpr:       { label: 'Déplacement pour rien',      tone: 'slate' },
}

const TONE = {
  green: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/40',
  amber: 'bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/40',
  slate: 'bg-ink/5 text-ink-secondary border-[color:var(--border-strong)]',
}

function Item({ icon, label, value, muted }: { icon: string; label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-start gap-2.5 min-w-0">
      <span className="text-lg leading-none mt-0.5 flex-shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10.5px] font-bold uppercase tracking-wide text-ink-muted">{label}</p>
        <p className={`text-sm font-semibold leading-snug break-words ${muted ? 'text-ink-muted font-normal' : 'text-ink'}`}>{value}</p>
      </div>
    </div>
  )
}

export default function Flux2ClosureCard({ mission, logs }: { mission: any; logs: AnyLog[] }) {
  const closure = logs.find(l => l.action === 'flux2_closed')
  if (!closure && !mission?.panne_motif_label) return null

  const md = closure?.metadata || {}
  const common = md.common || {}
  const outcome = OUTCOME_LABELS[md.outcome as string] || null
  const result = md.result || {}

  const hm = (s?: string | null) => s
    ? new Date(s).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })
    : null

  const signature = common.signature === 'signed' || mission.client_signature ? 'Signée par le client'
    : common.signature === 'refus'  ? 'A refusé de signer'
    : common.signature === 'absent' ? 'Client absent'
    : null

  const key = mission.key_recovered === true
    ? `Récupérée${mission.key_location ? ` · ${mission.key_location}` : ''}`
    : mission.key_recovered === false ? 'Non récupérée' : null

  const photos = Array.isArray(mission.driver_photos) ? mission.driver_photos.length : 0

  // Ce qui est effectivement parti chez l'assisteur — ou pourquoi rien n'est parti.
  const push =
    result.finCode ? [
      `Touring — ${endMissionLabel(String(result.finCode)).toLowerCase()}`,
      statusWords(result.statusBefore, result.statusAfter),
    ].filter(Boolean).join(' · ')
    : md.queued        ? 'Assistance injoignable — clôture mise en file, rattrapage automatique'
    : md.skipAssistance ? 'Clôturé sans l’assistance (à faire par le dispatch)'
    : result.internalOnly || result.skipped === 'aucune plateforme à appeler' ? 'Enregistré dans VD Soft — cette assistance se clôture par son propre canal'
    : mission.vab_onsite_at ? 'VAB — mission amenée à l’écran de code'
    : mission.axa_closed_at ? 'AXA go&assist — mission soldée'
    : null

  // Panne telle que l'assisteur la lit, en toutes lettres.
  const pushDetail = codeWords(result.codes)
  // Codes bruts : uniquement en infobulle, pour recoupement avec leur écran.
  const rawCodes = result.codes
    ? `fin ${result.finCode} · ${result.codes.cause}/${result.codes.desc}/${result.codes.result}`
    : undefined

  return (
    <div className="px-4 lg:px-8 pt-4">
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] overflow-hidden">

        <div className="flex items-center gap-3 px-4 py-3 border-b border-emerald-500/20 flex-wrap">
          <span className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center text-xl flex-shrink-0">🏁</span>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
              Clôture chauffeur
            </p>
            <p className="text-ink font-bold leading-tight truncate">
              {mission.panne_motif_label || outcome?.label || 'Intervention clôturée'}
            </p>
          </div>
          {outcome && (
            <span className={`px-3 py-1.5 rounded-full border text-xs font-bold ${TONE[outcome.tone]}`}>
              {outcome.label}
            </span>
          )}
          {hm(closure?.created_at || mission.completed_at) && (
            <span className="text-ink-muted text-sm font-semibold tabular-nums">
              {hm(closure?.created_at || mission.completed_at)}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-4 px-4 py-4">
          {mission.panne_motif_label && <Item icon="🔧" label="Motif" value={mission.panne_motif_label} />}
          {pushDetail && <Item icon="🩺" label="Panne déclarée à l'assistance" value={pushDetail} />}
          {signature            && <Item icon="✍️" label="Signature"  value={signature} muted={common.signature !== 'signed' && !mission.client_signature} />}
          {key                  && <Item icon="🔑" label="Clé"        value={key} />}
          {mission.vehicle_location && <Item icon="📍" label="Véhicule laissé" value={mission.vehicle_location} />}
          {mission.vehicle_mileage != null && <Item icon="🔢" label="Kilométrage" value={`${Number(mission.vehicle_mileage).toLocaleString('fr-BE')} km`} />}
          {mission.vehicle_vin  && <Item icon="🆔" label="Châssis" value={String(mission.vehicle_vin)} />}
          {photos > 0           && <Item icon="📷" label="Photos" value={`${photos} photo${photos > 1 ? 's' : ''}`} />}
          {mission.destination_address && (md.outcome === 'rem' || md.outcome === 'rem_vr') &&
            <Item icon="🏁" label="Déposé à" value={mission.destination_address} />}
        </div>

        {mission.closing_notes && (
          <div className="px-4 pb-4">
            <div className="rounded-xl bg-surface border border px-3 py-2.5">
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-ink-muted">Remarque</p>
              <p className="text-ink text-sm font-medium whitespace-pre-wrap leading-snug">{mission.closing_notes}</p>
            </div>
          </div>
        )}

        {push && (
          <div className="px-4 py-2.5 border-t border-emerald-500/20 bg-emerald-500/[0.04]" title={rawCodes}>
            <p className="text-[12px] text-ink-secondary">
              <span className="font-bold text-emerald-700 dark:text-emerald-300">Transmis :</span> {push}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
