'use client'
// En-tête de Check Véhicule pour tout le personnel : faire un check camion et voir
// les derniers rapports (les siens ; tous pour le bureau). Olivier 30/09/2026.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useT } from '@/lib/i18n/I18nProvider'
import { CHECK_LEVELS } from '@/lib/truck-checks/levels'

export default function CheckHub() {
  const { t } = useT()
  const [d, setD] = useState<any>(null)
  useEffect(() => { fetch('/api/truck-checks', { cache: 'no-store' }).then(r => r.json()).then(setD).catch(() => {}) }, [])
  return (
    <div className="max-w-3xl mx-auto px-4 pt-4 flex flex-col gap-3">
      <Link href="/check-vehicule/nouveau" className="flex items-center gap-4 rounded-2xl bg-brand text-white p-4 min-h-[72px]">
        <span className="text-3xl">🔧</span>
        <span><span className="block text-lg font-bold">{t('truck_check.start')}</span><span className="block text-sm opacity-90">{t('truck_check.start_sub')}</span></span>
      </Link>
      {d?.recent?.length > 0 && <section className="rounded-2xl border border-border bg-surface p-3">
        <p className="text-xs uppercase tracking-wide text-ink-muted mb-1">{t('truck_check.history')}</p>
        {d.recent.slice(0, d.viewer ? 15 : 6).map((c: any) => <Link key={c.id} href={`/check-vehicule/rapport/${c.id}`} className="flex items-center justify-between gap-2 min-h-[44px] border-b border-border last:border-0 text-sm">
          <span className="text-ink"><b className="font-mono">{c.truck_plate}</b> · {new Date(c.created_at).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' })}{d.viewer ? ` · ${c.driver_name || ''}` : ''} · {Number(c.mileage).toLocaleString('fr-BE')} km</span>
          <span className="text-ink-secondary whitespace-nowrap">{c.anomaly_count ? `${CHECK_LEVELS.find(l => l.level === c.max_level)?.emoji || ''} ${c.anomaly_count}` : '✅'}</span>
        </Link>)}
      </section>}
    </div>
  )
}
