'use client'
// Étape « véhicule de remplacement VAB » visible sur la fiche (Olivier 10/11/2026, maquette
// https://claude.ai/artifact/Xyvz63FWarPgn49ioj36k6 validée). VD Soft la pose depuis Comet (vab_vr) ; ici on ne
// choisit que son ordre (avant / après / mission à part, route /vab-vr) et le chauffeur note « Véhicule pris ».
// Les km et le forfait sont déjà calculés à partir de vab_vr : cette étape n'ajoute AUCUN stop (pas de double compte).
import { useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import { openNavigation, type NavApp } from '@/lib/open-navigation'

export default function EtapeVrVab({ missionId, vr, mode, navApp = 'gmaps', onChange }: {
  missionId: string; vr: any; mode: 'dispatch' | 'chauffeur'; navApp?: NavApp; onChange: () => void
}) {
  const { t } = useT()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [confirmSepare, setConfirmSepare] = useState(false)
  const [prisA, setPrisA] = useState<string | null>(vr?.picked_at || null)
  const [place, setPlace] = useState<string>(vr?.placement || 'before')
  // Le chauffeur peut aussi changer l'ordre quand VAB le demande autrement (Olivier 10/11/2026) : replié par défaut.
  const [ouvrirOrdre, setOuvrirOrdre] = useState(false)
  if (!vr || vr.standalone) return null

  const post = async (key: string, body: any) => {
    setBusy(key); setErr('')
    try {
      const r = await fetch(`/api/missions/${missionId}/vab-vr`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || t('vr_etape.erreur'))
      if (j.picked_at) setPrisA(j.picked_at)
      if (j.placement && j.placement !== 'separate') { setPlace(j.placement); setOuvrirOrdre(false) }
      onChange()
    } catch (e: any) { setErr(e?.message || t('vr_etape.erreur')) } finally { setBusy(null); setConfirmSepare(false) }
  }

  const heure = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })
  const vehicule = [vr.plate].filter(Boolean).join(' ')
  const ordre = place === 'after' ? t('vr_etape.ordre_apres') : place === 'to_decide' ? t('vr_etape.a_decider') : t('vr_etape.ordre_avant')
  const choix: [string, string][] = [['before', t('vr_etape.avant')], ['after', t('vr_etape.apres')], ['separate', t('vr_etape.separe')]]

  return (
    <div className="w-full bg-amber-50 dark:bg-amber-500/10 border-2 border-amber-500 rounded-2xl p-4 space-y-3">
      <div>
        <p className="text-amber-800 dark:text-amber-300 text-xs uppercase tracking-widest font-bold">🚗 {t('vr_etape.titre')} <span className="ml-1 inline-block rounded-full bg-amber-600 text-white px-2 py-0.5 text-[11px] normal-case tracking-normal">VAB</span></p>
        <p className="text-ink text-base font-semibold mt-1">{vehicule || t('vr_etape.vehicule')}</p>
        <p className="text-ink-secondary text-sm">{[vr.pickup?.name, vr.pickup?.address].filter(Boolean).join(' · ') || '—'}</p>
        <p className="text-ink text-sm mt-1">{t('vr_etape.livrer', { nom: vr.deliver?.name || vr.deliver?.address || '—' })}</p>
        <p className={`text-sm mt-1 font-semibold ${place === 'to_decide' ? 'text-red-700 dark:text-red-300' : 'text-amber-900 dark:text-amber-200'}`}>{ordre}</p>
      </div>

      {mode === 'chauffeur' && (prisA
        ? <p className="text-green-800 dark:text-green-300 text-sm font-semibold">✓ {t('vr_etape.pris_a', { h: heure(prisA) })}</p>
        : <div className="flex gap-2">
            <button type="button" onClick={() => openNavigation(navApp, vr.pickup?.lat, vr.pickup?.lng, vr.pickup?.address || vr.pickup?.name || '')}
              className="flex-1 min-h-[48px] rounded-xl bg-surface border text-ink font-semibold text-sm">{t('vr_etape.naviguer')}</button>
            <button type="button" disabled={!!busy} onClick={() => post('pris', { pris: true })}
              className="flex-1 min-h-[48px] rounded-xl bg-green-600 text-white font-bold text-sm disabled:opacity-60">{busy === 'pris' ? '…' : t('vr_etape.pris')}</button>
          </div>)}

      {mode === 'chauffeur' && place !== 'to_decide' && !ouvrirOrdre && (
        <button type="button" onClick={() => setOuvrirOrdre(true)} className="min-h-[44px] w-full rounded-xl border border-amber-400 bg-surface text-ink text-sm font-semibold">{t('vr_etape.changer')}</button>
      )}
      {(mode === 'dispatch' || place === 'to_decide' || ouvrirOrdre) && (
        <div className="flex flex-wrap gap-2">
          {choix.map(([k, l]) => (
            <button key={k} type="button" disabled={!!busy}
              onClick={() => k === 'separate' && !confirmSepare ? setConfirmSepare(true) : post(k, { placement: k })}
              aria-pressed={place === k}
              className={`min-h-[44px] px-3 rounded-xl border text-sm font-semibold disabled:opacity-60 ${place === k ? 'bg-amber-600 border-amber-600 text-white' : 'bg-surface border-amber-400 text-ink'}`}>
              {busy === k ? '…' : k === 'separate' && confirmSepare ? t('vr_etape.confirmer_separe') : l}
            </button>
          ))}
        </div>
      )}
      {mode === 'dispatch' && <p className="text-ink-muted text-xs">{t('vr_etape.note_dispatch')}</p>}
      {err && <p className="text-red-700 dark:text-red-300 text-sm font-semibold">{err}</p>}
    </div>
  )
}
