'use client'

// Liste « Mes missions » du chauffeur : tampon EN PAUSE + heure de retour (Olivier 18/10/2026).
import { useT } from '@/lib/i18n/I18nProvider'
import { pauseWhen } from './PauseBadge'

export default function DriverPauseTag({ until }: { until: string | null }) {
  const { t } = useT()
  return (
    <p className="mt-2 inline-flex items-center gap-2 rounded-lg bg-orange-100 text-orange-900 px-2.5 py-1 text-xs font-bold">
      <span>⏸ {t('pause_transfer.stamp')}</span><span className="font-semibold">{t('pause_transfer.list_back', { when: pauseWhen(until) })}</span>
    </p>
  )
}
