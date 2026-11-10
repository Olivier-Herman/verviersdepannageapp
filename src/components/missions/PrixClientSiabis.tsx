'use client'
// Prix à annoncer au client, Siabis non couvert (Olivier 10/11/2026, maquette
// https://claude.ai/artifact/2f8XKHfkAwSPMzUDqdXjUT validée) : le chauffeur voit le calcul ligne par ligne, affiché
// d'office, pour l'expliquer au client AVANT de commencer ; le client décide. Ce n'est pas un prix forcé : il suit la
// destination et le scénario. Rien n'est affiché si le détail ne retombe pas exactement sur le montant de la fiche.
import { useEffect, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'

interface Ligne { kind: string; majore: boolean; km: number | null; from: string | null; label: string; tvac: number }

const eur = (n: number) => `${n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

export default function PrixClientSiabis({ missionId, montantTvac, recalc }: { missionId: string; montantTvac: number; recalc: string }) {
  const { t } = useT()
  const [lignes, setLignes] = useState<Ligne[] | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/missions/${missionId}/price-estimate`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (alive) setLignes(Array.isArray(j?.client_lines) ? j.client_lines : []) })
      .catch(() => alive && setLignes([]))
    return () => { alive = false }
  }, [missionId, recalc])

  if (!lignes || lignes.length === 0) return null
  const total = Math.round(lignes.reduce((s, l) => s + l.tvac, 0) * 100) / 100
  if (Math.abs(total - montantTvac) > 0.05) return null   // détail incohérent avec la fiche : on n'affiche rien de faux

  const titre = (l: Ligne) => {
    const k = `prix_client.l_${l.kind}`
    const tr = t(k)
    return tr === k ? l.label : tr
  }
  const pourquoi = (l: Ligne) => {
    if (l.kind === 'pec') return t(l.majore ? 'prix_client.w_pec_maj' : 'prix_client.w_pec')
    if (l.kind === 'km' && l.km != null) return l.from ? t('prix_client.w_km_from', { km: String(l.km), from: l.from }) : t('prix_client.w_km', { km: String(l.km) })
    if (l.kind === 'km_dep' && l.km != null) return t('prix_client.w_km_dep', { km: String(l.km) })
    if (l.kind === 'balisage') return `${t('prix_client.w_balisage')}${l.majore ? ` ${t('prix_client.w_maj')}` : ''}`
    if (l.majore) return t('prix_client.w_maj')
    return ''
  }

  return (
    <div className="w-full bg-amber-50 dark:bg-amber-500/10 border-2 border-amber-500 rounded-2xl p-4 space-y-3">
      <div>
        <p className="text-amber-800 dark:text-amber-300 text-xs uppercase tracking-widest font-bold">💶 {t('prix_client.titre')}</p>
        <p className="text-ink text-3xl font-extrabold tabular-nums mt-1">{eur(montantTvac)} <span className="text-ink-muted text-sm font-medium">{t('prix_client.tvac')}</span></p>
        <p className="text-amber-900 dark:text-amber-200 text-sm mt-1">{t('prix_client.texte')}</p>
      </div>
      <div className="bg-surface border rounded-xl overflow-hidden">
        {lignes.map((l, i) => {
          const w = pourquoi(l)
          return (
            <div key={i} className={`px-3 py-2.5 ${i ? 'border-t' : ''}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-ink text-sm font-semibold">{titre(l)}</span>
                <span className="text-ink text-sm font-semibold tabular-nums whitespace-nowrap">{eur(l.tvac)}</span>
              </div>
              {w && <p className="text-ink-muted text-xs mt-0.5">{w}</p>}
            </div>
          )
        })}
        <div className="px-3 py-2.5 border-t bg-surface-2 flex items-baseline justify-between gap-3">
          <span className="text-ink text-sm font-bold">{t('prix_client.total')}</span>
          <span className="text-ink text-sm font-bold tabular-nums whitespace-nowrap">{eur(montantTvac)}</span>
        </div>
      </div>
    </div>
  )
}
