// Mission en pause / transfert en attente (Olivier 18/10/2026) : le même bandeau dans toutes les
// vues bureau (dispatch carte, liste, tableau, fiche, dossier, missions par chauffeur).
// Pause : orange « EN PAUSE · Reprise prévue … », rouge quand l'heure est dépassée.
export type PauseFields = { paused_at?: string | null; pause_until?: string | null; pause_reason?: string | null; transfer_to?: string | null; pause_released_at?: string | null; released_by?: { name?: string | null } | null }

export const pauseFrame = (m: PauseFields | null | undefined) => (m?.paused_at ? 'border-2 border-orange-500 ring-2 ring-orange-400/60' : '')

export function pauseWhen(iso?: string | null) {
  return iso ? new Date(iso).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
}

export default function PauseBadge({ m, className = '' }: { m: PauseFields | null | undefined; className?: string }) {
  if (!m) return null
  if (m.paused_at) {
    const late = !!m.pause_until && new Date(m.pause_until).getTime() < Date.now()
    return (
      <div className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold ${late ? 'bg-red-100 text-red-800' : 'bg-orange-100 text-orange-900'} ${className}`}>
        <span className="text-base leading-none">⏸</span>
        <span>{m.pause_released_at
          // Remise au dispatch (29/10/2026) : sans chauffeur, à réattribuer ; tout chauffeur peut la reprendre.
          ? <>EN PAUSE, REMISE AU DISPATCH par {m.released_by?.name || 'un chauffeur'} le {pauseWhen(m.pause_released_at)} · à reprendre dès {pauseWhen(m.pause_until)}{late ? ' (dépassé)' : ''}{m.pause_reason ? ` · ${m.pause_reason}` : ''} · déjà commencée, à réattribuer</>
          : <>EN PAUSE · Reprise prévue {pauseWhen(m.pause_until)}{late ? ' — dépassée' : ''}{m.pause_reason ? ` · ${m.pause_reason}` : ''}</>}</span>
      </div>
    )
  }
  if (m.transfer_to) return <div className={`rounded-lg px-3 py-1.5 text-xs font-bold bg-blue-100 text-blue-900 ${className}`}>🔁 Transfert vers un autre chauffeur en attente de sa réponse</div>
  return null
}
