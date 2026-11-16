'use client'

// Fiche clôturée par le paiement (mal garée « déplacement payé », dépannage
// privé ou Siabis payé sur place) : le chauffeur ne passe pas par l'écran de
// clôture, la fiche se ferme dès que le client a payé. Fred Bovy a cru le
// 12/11/2026 (2KEG242) que ses photos étaient perdues. On lui montre donc ce
// qui est enregistré (paiement + photos) et il peut encore en ajouter pendant
// 30 minutes. Olivier 12/11/2026.

import { useRef, useState } from 'react'
import { Camera, ImagePlus, Loader2 } from 'lucide-react'
import BurstCamera from '@/components/camera/BurstCamera'
import { usePhotoQueue } from '@/components/qr/AddPhotosButton'
import { useT } from '@/lib/i18n/I18nProvider'
import { formatEur } from '@/lib/format'

export const PHOTOS_APRES_PAIEMENT_MIN = 30

/** Fiche fermée par le paiement il y a moins de 30 minutes ? */
export function photosApresPaiementOuvert(m: { payment_collected_at?: string | null; completed_at?: string | null }): boolean {
  if (!m.payment_collected_at || !m.completed_at) return false
  const fin = Date.parse(m.completed_at)
  const paye = Date.parse(m.payment_collected_at)
  if (!Number.isFinite(fin) || !Number.isFinite(paye)) return false
  // Clôturée par le paiement = clôture dans les 2 minutes qui suivent l'encaissement.
  if (fin - paye > 2 * 60_000 || fin - paye < -60_000) return false
  return Date.now() - fin < PHOTOS_APRES_PAIEMENT_MIN * 60_000
}

export default function PhotosApresPaiement({ missionId, completedAt, amount, mode, photos }: {
  missionId: string
  completedAt: string
  amount: number
  mode: string | null
  photos: string[]
}) {
  const { t } = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  const [camera, setCamera] = useState(false)
  const q = usePhotoQueue(missionId, 'paiement')
  const all = [...photos, ...q.added.filter(u => !photos.includes(u))]
  const n = q.total ?? all.length
  const limite = new Date(Date.parse(completedAt) + PHOTOS_APRES_PAIEMENT_MIN * 60_000)
    .toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })
  const modeLabel = mode === 'cash' ? t('payment.cash')
    : mode === 'sumup' || mode === 'card' || mode === 'bancontact' ? t('payment.card')
    : mode === 'transfer' ? t('payment.transfer')
    : null

  return (
    <div className="w-full max-w-sm space-y-3">
      {camera && <BurstCamera title={t('finished_missions.photos_title')} count={q.sent + q.pending} onShot={b => q.enqueue(b)} onClose={() => setCamera(false)} />}
      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
        onChange={e => { Array.from(e.target.files || []).forEach(f => q.enqueue(f)); e.target.value = '' }} />

      <div className="bg-green-50 border border-green-300 rounded-2xl p-4 text-center">
        <p className="text-green-900 font-bold text-base">
          💳 {t('finished_missions.paid_title', { amount: formatEur(amount) })}{modeLabel ? ` · ${modeLabel}` : ''}
        </p>
        <p className="text-green-800 text-sm mt-1">{t('finished_missions.paid_closed')}</p>
      </div>

      <div className="bg-surface border rounded-2xl p-3 space-y-2">
        <p className={`text-sm font-semibold text-center ${n === 0 ? 'text-amber-800' : 'text-ink'}`}>
          📷 {n === 0 ? t('finished_missions.photos_none') : t('finished_missions.photos_count', { n })}
        </p>
        {all.length > 0 && (
          <div className="grid grid-cols-4 gap-1.5">
            {all.map(u => <img key={u} src={u} alt="" className="w-full aspect-square object-cover rounded-lg border" />)}
          </div>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={() => setCamera(true)}
            className="flex-1 min-h-[44px] py-3 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2">
            <Camera size={18} /> {t('finished_missions.add_photos')}
          </button>
          <button type="button" onClick={() => inputRef.current?.click()} aria-label={t('finished_missions.gallery')}
            className="min-h-[44px] px-3 border border-strong rounded-xl text-ink-secondary hover:bg-surface-hover flex items-center justify-center gap-1.5 text-sm font-semibold">
            <ImagePlus size={18} /> {t('finished_missions.gallery')}
          </button>
        </div>
        <p className="text-ink-muted text-xs text-center">
          {t('finished_missions.add_until', { time: limite })}
          {q.sent > 0 && <span className="text-emerald-700 font-semibold"> · {t('finished_missions.added', { n: q.sent })}</span>}
          {q.pending > 0 && <span className="text-ink-secondary font-semibold"> · <Loader2 size={11} className="inline animate-spin" /> {t('finished_missions.sending', { n: q.pending })}</span>}
          {q.failed > 0 && <span className="text-red-700 font-semibold"> · {t('finished_missions.failed', { n: q.failed })}</span>}
        </p>
      </div>
    </div>
  )
}
