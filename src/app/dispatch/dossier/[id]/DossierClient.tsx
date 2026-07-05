'use client'
// Vue DOSSIER unifiée — skeleton lecture seule (preview).
// Accordéon anté-chronologique : dernière action en haut (dépliée), les
// précédentes repliées (dépliables). Fonds alternés par leg (A gris, B blanc…).

import { useEffect, useState } from 'react'

interface Leg {
  letter:          string
  kind:            'rem' | 'parc' | 'rel'
  mission_id:      string
  mission_number:  number | null
  status:          string
  title:           string
  billed_to_name:  string | null
  billed_inherited?: boolean
  driver_name:     string | null
  started_at:      string | null
  is_last:         boolean
  details:         any
}
interface HistoryLine { letter: string; at: string | null; action: string | null; notes: string | null; actor: string | null }
interface Dossier {
  ref: string; root_id: string; dossier_number: string | null; source: string | null
  vehicle: { plate: string | null; brand: string | null; model: string | null; vin: string | null }
  client:  { name: string | null; phone: string | null }
  legs: Leg[]
  history: HistoryLine[]
}

const fmt = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

export default function DossierClient({ id, isSuperadmin }: { id: string; isSuperadmin: boolean }) {
  const [data, setData]       = useState<Dossier | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [open, setOpen]       = useState<Set<string>>(new Set())
  const [flagMode, setFlagMode] = useState<string>('')

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/dossier/${id}`)
        const j = await r.json()
        if (!r.ok || !j.ok) throw new Error(j.error || 'Erreur')
        setData(j.dossier)
        // Déplie par défaut la dernière action.
        const last = (j.dossier.legs as Leg[]).find(l => l.is_last)
        setOpen(new Set(last ? [last.letter] : []))
      } catch (e: any) { setError(e.message) } finally { setLoading(false) }
    })()
  }, [id])

  useEffect(() => {
    if (!isSuperadmin) return
    fetch('/api/admin/feature-flags').then(r => r.json()).then(j => {
      const f = (j.flags || []).find((x: any) => x.key === 'dossier_view')
      if (f) setFlagMode(f.mode)
    }).catch(() => {})
  }, [isSuperadmin])

  const setMode = async (mode: string) => {
    setFlagMode(mode)
    await fetch('/api/admin/feature-flags', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'dossier_view', mode }),
    }).catch(() => {})
  }

  const toggle = (letter: string) => setOpen(prev => {
    const n = new Set(prev)
    n.has(letter) ? n.delete(letter) : n.add(letter)
    return n
  })

  if (loading) return <div className="p-8 text-ink-muted text-sm">Chargement du dossier…</div>
  if (error || !data) return <div className="p-8 text-critical text-sm">⚠ {error || 'Dossier introuvable'}</div>

  const veh = [data.vehicle.brand, data.vehicle.model].filter(Boolean).join(' ')
  // Anté-chrono : dernière action en haut.
  const legsDisplay = [...data.legs].reverse()

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">

      {/* Bandeau preview + toggle (superadmin) */}
      {isSuperadmin && (
        <div className="flex items-center justify-between gap-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-2.5">
          <span className="text-amber-700 dark:text-amber-300 text-xs font-semibold">🧪 Preview « Fiche dossier »</span>
          <div className="flex items-center gap-1">
            {([['off', 'Off'], ['superadmin', 'Moi'], ['all', 'Tout le monde']] as const).map(([m, lbl]) => (
              <button key={m} onClick={() => setMode(m)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                  flagMode === m ? 'bg-amber-500 text-white' : 'bg-surface border text-ink-secondary hover:text-ink'
                }`}>{lbl}</button>
            ))}
          </div>
        </div>
      )}

      {/* En-tête dossier */}
      <div className="bg-surface border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-ink font-bold text-lg">Dossier {data.ref}</h1>
          {data.source && <span className="text-xs font-semibold text-ink-secondary bg-surface-2 border rounded-lg px-2 py-0.5">{data.source}</span>}
        </div>
        <p className="text-ink-secondary text-sm">{veh || '—'}{data.vehicle.plate ? ` · ${data.vehicle.plate}` : ''}</p>
        {data.client.name && <p className="text-ink-muted text-xs mt-0.5">{data.client.name}{data.client.phone ? ` · ${data.client.phone}` : ''}</p>}
        {data.dossier_number && <p className="text-ink-faint text-xs mt-0.5 font-mono">{data.dossier_number}</p>}
      </div>

      {/* Accordéon des actions (anté-chrono) */}
      <div className="space-y-2">
        {legsDisplay.map((leg) => {
          const isOpen = open.has(leg.letter)
          // Fond alterné par lettre : A(gris) B(blanc) C(gris)… contraste marqué.
          const idx = leg.letter.charCodeAt(0) - 65
          const bg  = idx % 2 === 0 ? 'bg-zinc-100 dark:bg-zinc-800' : 'bg-white dark:bg-zinc-900'
          return (
            <div key={leg.letter} className={`${bg} border rounded-2xl overflow-hidden`}>
              {/* Bandeau (toujours visible) */}
              <button onClick={() => toggle(leg.letter)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-hover/50 transition">
                <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-ink/5 border flex items-center justify-center text-xs font-bold text-ink">-{leg.letter}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-ink text-sm font-semibold truncate">{leg.title}</p>
                  <p className="text-ink-muted text-xs truncate">{collapsedSummary(leg)}</p>
                </div>
                <span className="text-ink-faint text-xs flex-shrink-0">{fmt(leg.started_at)}</span>
                <span className="text-ink-muted text-sm flex-shrink-0">{isOpen ? '▲' : '▼'}</span>
              </button>

              {/* Détail (déplié) */}
              {isOpen && (
                <div className="px-4 pb-4 pt-1 border-t space-y-1.5 text-sm">
                  <Row label="Statut"    value={leg.status} />
                  {leg.driver_name    && <Row label="Chauffeur" value={leg.driver_name} />}
                  {leg.billed_to_name && <Row label="Facturé à" value={`${leg.billed_to_name}${leg.billed_inherited ? ' (hérité du remorquage)' : ''}`} />}
                  {leg.details?.source              && <Row label="Source"        value={leg.details.source} />}
                  {leg.details?.incident_address    && <Row label={leg.kind === 'rel' ? 'Départ (parc)' : 'Lieu incident'} value={leg.details.incident_address} />}
                  {leg.details?.destination_address && <Row label={leg.kind === 'rel' ? 'Relivraison'   : 'Destination'}   value={leg.details.destination_address} />}
                  {leg.details?.redelivery_address  && <Row label="Adresse de relivraison" value={leg.details.redelivery_address} />}
                  {leg.kind === 'parc' && (
                    <>
                      {leg.details?.parc_zone_key && <Row label="Zone parc" value={leg.details.parc_zone_key} />}
                      <Row label="Gardiennage" value={`${leg.details?.gardiennage_days ?? '—'} jour(s)${leg.details?.still_parked ? ' (en cours)' : ''}`} />
                    </>
                  )}
                  <p className="text-ink-faint text-xs pt-2 italic">Actions de l'étape — à câbler (inline, sans quitter le dossier).</p>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Historique UNIFIÉ — toutes actions confondues, du début à la fin (anté-chrono) */}
      {data.history?.length > 0 && (
        <div className="bg-surface border rounded-2xl p-5">
          <h2 className="text-ink-muted text-xs font-semibold uppercase tracking-widest mb-3">Historique — dossier complet</h2>
          <div className="space-y-2.5">
            {data.history.map((h, i) => (
              <div key={i} className="flex gap-2.5 text-sm">
                <span className="flex-shrink-0 mt-0.5 h-5 min-w-[26px] px-1 text-center text-[10px] font-bold text-ink-secondary bg-ink/5 border rounded flex items-center justify-center">-{h.letter}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-ink leading-snug">{h.notes || h.action}</p>
                  <p className="text-ink-faint text-xs">{h.actor ? `${h.actor} · ` : ''}{fmt(h.at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-ink-faint text-xs text-center pt-1">
        ↑ dernière action en haut · première action en bas ↓ — preview
      </p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-ink-muted text-xs w-32 flex-shrink-0">{label}</span>
      <span className="text-ink text-sm">{value}</span>
    </div>
  )
}

function collapsedSummary(leg: Leg): string {
  const bits: string[] = []
  if (leg.kind === 'parc') {
    if (leg.details?.parc_zone_key) bits.push(`zone ${leg.details.parc_zone_key}`)
    if (leg.details?.gardiennage_days != null) bits.push(`${leg.details.gardiennage_days} j`)
  } else {
    if (leg.details?.destination_address) bits.push(leg.details.destination_address)
    if (leg.driver_name) bits.push(leg.driver_name)
  }
  if (leg.billed_to_name) bits.push(leg.billed_to_name)
  bits.push(leg.status)
  return bits.filter(Boolean).join(' · ')
}
