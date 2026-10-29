'use client'
// Choix du garage du réseau agréé Touring par le chauffeur (Olivier 29/10/2026, maquette
// https://claude.ai/artifact/6ckD6EUH86meDtcGRQavAt validée) : liste Touring complète triée par distance, recherche,
// raccourcis par commune, 15 à la fois, confirmation. Fermeture par ✕ seulement.
import { useEffect, useMemo, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'

export interface GarageAgreeChoix { cidPrx: string; nom: string; label: string; lat: number; lng: number; km: number; localite: string; demande: boolean }

const PAGE = 15
const norm = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function GarageAgreePicker({ missionId, onClose, onChosen }: { missionId: string; onClose: () => void; onChosen: (g: GarageAgreeChoix) => void }) {
  const { t } = useT()
  const [garages, setGarages] = useState<GarageAgreeChoix[] | null>(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [commune, setCommune] = useState('')
  const [n, setN] = useState(PAGE)
  const [sel, setSel] = useState<GarageAgreeChoix | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`/api/missions/${missionId}/garages-agrees`, { cache: 'no-store' })
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (!alive) return; if (!ok) setErr(j.error || t('garage_agree.erreur')); else setGarages(j.garages || []) })
      .catch(() => alive && setErr(t('garage_agree.erreur')))
    return () => { alive = false }
  }, [missionId, t])

  // Raccourcis : les 5 communes les plus proches (une seule fois chacune).
  const communes = useMemo(() => {
    const out: string[] = []
    for (const g of garages || []) { const c = g.localite; if (c && !out.some(x => norm(x) === norm(c))) out.push(c); if (out.length >= 5) break }
    return out
  }, [garages])
  const filtres = useMemo(() => (garages || []).filter(g =>
    (!q || norm(`${g.nom} ${g.label}`).includes(norm(q))) && (!commune || norm(g.localite) === norm(commune))), [garages, q, commune])
  const indiques = filtres.filter(g => g.demande)
  const proches = filtres.filter(g => !g.demande)

  const choisir = async () => {
    if (!sel) return
    setBusy(true); setErr('')
    try {
      const r = await fetch(`/api/missions/${missionId}/garages-agrees`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cidPrx: sel.cidPrx }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || t('garage_agree.erreur'))
      onChosen(sel)
    } catch (e: any) { setErr(e?.message || t('garage_agree.erreur')); setSel(null) } finally { setBusy(false) }
  }

  const carte = (g: GarageAgreeChoix) => (
    <button key={g.cidPrx} type="button" onClick={() => setSel(g)}
      className="w-full min-h-[64px] bg-surface border rounded-2xl p-3 flex items-center gap-3 text-left active:scale-[0.99] transition">
      <div className="min-w-0 flex-1">
        {g.demande && <span className="inline-block bg-amber-400 text-amber-950 text-[11px] font-bold rounded px-1.5 py-0.5 mb-1">{t('garage_agree.indique')}</span>}
        <p className="text-ink text-[15px] font-bold leading-tight">{g.nom}</p>
        <p className="text-ink-muted text-xs truncate">{g.label.split(', ').slice(1).join(', ')}</p>
      </div>
      <span className="text-ink text-sm font-bold whitespace-nowrap">{g.km} km</span>
    </button>
  )

  return (
    <div className="fixed inset-0 z-[70] bg-page flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="flex items-start gap-3 px-4 pt-4">
        <div className="flex-1 min-w-0">
          <p className="text-ink text-lg font-bold">{t('garage_agree.titre')}</p>
          {garages && <p className="text-ink-muted text-xs">{t('garage_agree.sous_titre', { n: garages.length })}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label={t('common.close')} className="w-11 h-11 rounded-xl bg-surface border text-ink text-lg shrink-0">✕</button>
      </div>
      <div className="px-4 pt-3">
        <input value={q} onChange={e => { setQ(e.target.value); setN(PAGE) }} placeholder={t('garage_agree.recherche')}
          className="w-full min-h-[48px] rounded-xl bg-surface border px-4 text-base text-ink" />
        {communes.length > 1 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {communes.map(c => (
              <button key={c} type="button" onClick={() => { setCommune(commune === c ? '' : c); setN(PAGE) }}
                className={`min-h-[40px] px-3 rounded-full border text-sm capitalize ${commune === c ? 'bg-blue-600 border-blue-600 text-white' : 'bg-surface text-ink'}`}>{c.toLowerCase()}</button>
            ))}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {err && <p className="text-red-600 dark:text-red-400 text-sm font-semibold">{err}</p>}
        {!garages && !err && <p className="text-ink-muted text-sm py-6 text-center">{t('garage_agree.chargement')}</p>}
        {garages && indiques.length > 0 && <p className="text-ink-muted text-[11px] uppercase tracking-widest pt-1">{t('garage_agree.indique')}</p>}
        {indiques.map(carte)}
        {garages && <p className="text-ink-muted text-[11px] uppercase tracking-widest pt-1">{t('garage_agree.proches')}</p>}
        {proches.slice(0, n).map(carte)}
        {garages && filtres.length === 0 && <p className="text-ink-muted text-sm text-center py-4">{t('garage_agree.aucun')}</p>}
        {proches.length > n && (
          <button type="button" onClick={() => setN(n + PAGE)} className="w-full min-h-[48px] rounded-xl border text-ink-secondary text-sm">
            {t('garage_agree.suivants', { n: Math.min(PAGE, proches.length - n) })}
          </button>
        )}
      </div>
      {sel && (
        <div className="absolute inset-x-0 bottom-0 bg-surface border-t rounded-t-3xl px-4 pt-4 shadow-2xl" style={{ paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))' }}>
          <p className="text-ink-muted text-sm">{t('garage_agree.deposer_chez')}</p>
          <p className="text-ink text-lg font-extrabold">{sel.nom}</p>
          <p className="text-ink-secondary text-sm">{sel.label.split(', ').slice(1).join(', ')} · {sel.km} km</p>
          <div className="grid gap-2 mt-4">
            <button type="button" disabled={busy} onClick={choisir} className="min-h-[52px] rounded-2xl bg-green-600 text-white font-bold text-base disabled:opacity-60">{busy ? '…' : t('garage_agree.oui')}</button>
            <button type="button" disabled={busy} onClick={() => setSel(null)} className="min-h-[52px] rounded-2xl bg-surface-2 border text-ink font-semibold">{t('garage_agree.non')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
