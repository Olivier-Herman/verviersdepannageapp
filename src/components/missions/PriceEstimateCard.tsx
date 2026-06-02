'use client'

import { useEffect, useState } from 'react'

interface PriceEstimate {
  ok:            boolean
  reason?:       string
  source:        string
  mission_type:  string
  forfait:       number | null
  km_charged:    number
  km_inclus:     number
  km_extra:      number
  km_extra_eur:  number
  parc_jours:    number
  parc_eur:      number
  subtotal_eur:  number
  surcharge_pct: number
  surcharge_eur: number
  total_eur:     number
  is_autofac:    boolean
  tariff_id:     string
  tariff_doc_path: string | null
  tariff_doc_name: string | null
  special_tarif?: boolean   // Olivier 2026-06-02 PM : true si special_tarif_htva applique
  breakdown:     { label: string; amount: number | null; note?: string }[]
}

interface Props {
  missionId: string
  /** Olivier 2026-06-02 : overrides depuis le form en cours d edition cote
   *  dispatch. Permet de voir le tarif live SANS save + refresh. L API
   *  /api/missions/[id]/price-estimate les recoit en query params. */
  overrides?: {
    source?:                string
    mission_type?:          string
    snc_scenario?:          string | null
    snc_requires_balisage?: boolean
    incident_lat?:          number | null
    incident_lng?:          number | null
    destination_lat?:       number | null
    destination_lng?:       number | null
    billed_to_id?:          number | null
    billed_to_name?:        string | null
    special_tarif_htva?:    number | null
  }
}

const TVA_RATE = 0.21
const fmt = (n: number | null | undefined) => n != null ? `${n.toFixed(2)} €` : '—'
const toTvac = (htva: number) => Math.round(htva * (1 + TVA_RATE) * 100) / 100

export default function PriceEstimateCard({ missionId, overrides }: Props) {
  const [data, setData] = useState<PriceEstimate | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  // Serialize overrides en query string (stable, debounced via useEffect dep)
  const qs = (() => {
    if (!overrides) return ''
    const p = new URLSearchParams()
    Object.entries(overrides).forEach(([k, v]) => {
      if (v == null || v === '') return
      if (typeof v === 'boolean') p.set(k, v ? '1' : '0')
      else p.set(k, String(v))
    })
    const s = p.toString()
    return s ? `?${s}` : ''
  })()

  useEffect(() => {
    setLoading(true)
    const ctrl = new AbortController()
    const handler = setTimeout(() => {
      fetch(`/api/missions/${missionId}/price-estimate${qs}`, { signal: ctrl.signal })
        .then(r => r.json())
        .then(setData)
        .catch(e => { if (e.name !== 'AbortError') setData(null) })
        .finally(() => setLoading(false))
    }, 400)  // debounce : evite de spammer pendant la saisie
    return () => { clearTimeout(handler); ctrl.abort() }
  }, [missionId, qs])

  if (loading) {
    return (
      <div className="bg-surface border rounded-xl p-4 text-sm text-ink-faint">
        💰 Calcul estimation tarif…
      </div>
    )
  }

  if (!data || !data.ok) {
    return (
      <div className="bg-surface border rounded-xl p-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="font-semibold flex items-center gap-2">
            💰 <span>Estimation tarif</span>
          </span>
          <span className="text-ink-faint text-xs">Indisponible</span>
        </div>
        <p className="text-xs text-ink-faint mt-1">
          {data?.reason || 'Aucun tarif configuré pour cette mission.'}
          {' '}
          <a href="/admin/tarifs" className="underline text-brand">Configurer →</a>
        </p>
      </div>
    )
  }

  return (
    <div className={`border rounded-xl p-4 text-sm ${
      data.special_tarif
        ? 'bg-amber-50 border-2 border-amber-500'
        : 'bg-surface border'
    }`}>
      {data.special_tarif && (
        <div className="mb-3 -mt-1 -mx-1 px-3 py-2 bg-amber-100 border-l-4 border-amber-600 rounded-r text-amber-900 text-xs font-semibold flex items-center gap-2">
          <span className="text-base">⚡</span>
          <span>Tarif spécial appliqué — calcul automatique ignoré</span>
        </div>
      )}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between gap-2"
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">{data.special_tarif ? '⚡' : '💰'}</span>
          <div className="text-left">
            <div className={`text-xs uppercase tracking-wider ${data.special_tarif ? 'text-amber-700 font-semibold' : 'text-ink-faint'}`}>
              {data.special_tarif ? 'Tarif spécial (prix convenu)' : 'Estimation tarif'}
            </div>
            <div className="text-xl font-display font-bold">{fmt(data.total_eur)} <span className="text-xs text-ink-faint font-normal">HTVA</span></div>
            <div className="text-xs text-ink-muted">{fmt(toTvac(data.total_eur))} TVAC</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data.is_autofac && (
            <span className="px-2 py-0.5 bg-amber-500/15 text-amber-500 rounded text-[10px] font-medium uppercase tracking-wider">
              Autofac
            </span>
          )}
          <span className="text-ink-faint text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-surface-hover space-y-3">
          {(() => {
            // Olivier 2026-05-28 : 2 sections distinctes (Depannage / Gardiennage)
            // + sous-totaux + total general. Classification par label (Parc /
            // Gardiennage / SERV-PARC).
            const isGardiennage = (label: string) =>
              /\b(parc|gardiennage|serv-parc)\b/i.test(label)
            const depannageLines  = data.breakdown.filter(l => !isGardiennage(l.label))
            const gardiennageLines = data.breakdown.filter(l =>  isGardiennage(l.label))

            // La majoration s applique au depannage (pas au gardiennage)
            const depannageBase = depannageLines.reduce((s, l) => s + (l.amount || 0), 0)
            const depannageSubtotal = depannageBase + (data.surcharge_eur || 0)
            const gardiennageSubtotal = gardiennageLines.reduce((s, l) => s + (l.amount || 0), 0)

            return (
              <>
                {/* SECTION DEPANNAGE */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🚛</span>
                    <span className="text-xs font-bold uppercase tracking-wider text-ink-secondary">Tarif dépannage</span>
                  </div>
                  {depannageLines.length === 0 && (
                    <p className="text-xs text-ink-faint italic">Aucune ligne dépannage</p>
                  )}
                  {depannageLines.map((line, i) => (
                    <div key={i} className="flex items-baseline justify-between gap-2 text-xs">
                      <div className="flex-1">
                        <span className="text-ink-secondary">{line.label}</span>
                        {line.note && <span className="text-ink-faint ml-2">— {line.note}</span>}
                      </div>
                      <span className={line.amount && line.amount > 0 ? 'font-medium' : 'text-ink-faint'}>
                        {line.amount != null ? fmt(line.amount) : '—'}
                      </span>
                    </div>
                  ))}
                  {data.surcharge_pct > 0 && (
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-ink-faint">Majoration ({data.surcharge_pct}%)</span>
                      <span className="font-medium">+{fmt(data.surcharge_eur)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-surface-hover">
                    <span className="text-ink-secondary text-xs font-semibold">Sous-total dépannage HT</span>
                    <span className="font-medium text-sm">{fmt(depannageSubtotal)}</span>
                  </div>
                </div>

                {/* SECTION GARDIENNAGE */}
                <div className="space-y-2 pt-2 border-t border-surface-hover">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🅿️</span>
                    <span className="text-xs font-bold uppercase tracking-wider text-ink-secondary">Tarif gardiennage</span>
                  </div>
                  {gardiennageLines.length === 0 && (
                    <p className="text-xs text-ink-faint italic">
                      Pas de gardiennage (véhicule pas en parc ou tarif non configuré)
                    </p>
                  )}
                  {gardiennageLines.map((line, i) => (
                    <div key={i} className="flex items-baseline justify-between gap-2 text-xs">
                      <div className="flex-1">
                        <span className="text-ink-secondary">{line.label}</span>
                        {line.note && <span className="text-ink-faint ml-2">— {line.note}</span>}
                      </div>
                      <span className={line.amount && line.amount > 0 ? 'font-medium' : 'text-ink-faint'}>
                        {line.amount != null ? fmt(line.amount) : '—'}
                      </span>
                    </div>
                  ))}
                  {gardiennageLines.length > 0 && (
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-surface-hover">
                      <span className="text-ink-secondary text-xs font-semibold">Sous-total gardiennage HT</span>
                      <span className="font-medium text-sm">{fmt(gardiennageSubtotal)}</span>
                    </div>
                  )}
                </div>

                {/* TOTAL GENERAL */}
                <div className="pt-2 border-t-2 border-ink/20 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold">Total général HTVA</span>
                    <span className="font-display font-bold text-base">{fmt(data.total_eur)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-ink-muted">Total TVAC ({Math.round(TVA_RATE * 100)}%)</span>
                    <span className="font-medium text-ink-muted">{fmt(toTvac(data.total_eur))}</span>
                  </div>
                </div>
              </>
            )
          })()}

          <div className="text-[10px] text-ink-faint pt-2 border-t border-surface-hover">
            Tarif source {data.source.toUpperCase()} / {data.mission_type}
            {data.tariff_doc_name && (
              <>
                {' '}—{' '}
                <a
                  href={data.tariff_doc_path ? `/api/admin/tarifs/document?path=${encodeURIComponent(data.tariff_doc_path)}` : '#'}
                  target="_blank"
                  rel="noopener"
                  className="underline"
                >
                  {data.tariff_doc_name}
                </a>
              </>
            )}
          </div>
          <p className="text-[10px] text-ink-faint italic">
            ⚠️ Estimation indicative. Le montant facturé final peut différer (négociation, conditions spéciales, etc.).
          </p>
        </div>
      )}
    </div>
  )
}
