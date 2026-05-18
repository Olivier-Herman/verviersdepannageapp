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
  breakdown:     { label: string; amount: number | null; note?: string }[]
}

interface Props {
  missionId: string
}

const fmt = (n: number | null | undefined) => n != null ? `${n.toFixed(2)} €` : '—'

export default function PriceEstimateCard({ missionId }: Props) {
  const [data, setData] = useState<PriceEstimate | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/missions/${missionId}/price-estimate`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [missionId])

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
    <div className="bg-surface border rounded-xl p-4 text-sm">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between gap-2"
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">💰</span>
          <div className="text-left">
            <div className="text-xs text-ink-faint uppercase tracking-wider">Estimation tarif</div>
            <div className="text-xl font-display font-bold">{fmt(data.total_eur)} HT</div>
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
        <div className="mt-3 pt-3 border-t border-surface-hover space-y-2">
          {data.breakdown.map((line, i) => (
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
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-surface-hover">
            <span className="text-ink-secondary text-xs">Sous-total HT</span>
            <span className="font-medium">{fmt(data.subtotal_eur)}</span>
          </div>
          {data.surcharge_pct > 0 && (
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-ink-faint">Majoration ({data.surcharge_pct}%)</span>
              <span className="font-medium">+{fmt(data.surcharge_eur)}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-surface-hover">
            <span className="font-semibold">Total HT</span>
            <span className="font-display font-bold text-base">{fmt(data.total_eur)}</span>
          </div>
          <div className="text-[10px] text-ink-faint pt-2">
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
          <p className="text-[10px] text-ink-faint italic pt-1">
            ⚠️ Estimation indicative. Le montant facturé final peut différer (négociation, conditions spéciales, etc.).
          </p>
        </div>
      )}
    </div>
  )
}
