'use client'
// src/components/mission/VrContratCard.tsx — contrat VR VAB côté chauffeur (Olivier 23/10/2026).
// Tuile sur la fiche dès qu'une livraison de VR est liée (vab_vr, jamais un test sur la source).
// « Compléter info VR » ouvre le QR pour le client ; pendant que le client remplit sa partie sur son
// téléphone, le chauffeur note l'état du véhicule prêté juste en dessous. Avancement interrogé
// toutes les 3 s tant que la fenêtre est ouverte. Fermeture par ✕ uniquement.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { X, Loader2, Smartphone } from 'lucide-react'
import { T } from '@/lib/i18n/T'
import { useT } from '@/lib/i18n/I18nProvider'

interface Etat {
  contrat: null | { id: string; status: string; expire: boolean; vehicule: any; signed_at: string | null }
  avancement?: { photos: number; infos: boolean; signe: boolean; vehicule: boolean }
}
const PROPRETES = ['propre', 'correct', 'sale'] as const
const CARBURANTS = [0, 25, 50, 75, 100]

export default function VrContratCard({ missionId, vr }: { missionId: string; vr: any }) {
  const [etat, setEtat] = useState<Etat | null>(null)
  const [ouvert, setOuvert] = useState(false)
  const charger = useCallback(async () => {
    try { const j = await fetch(`/api/missions/${missionId}/vr-contrat`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null); if (j) setEtat(j) } catch {}
  }, [missionId])
  useEffect(() => { charger() }, [charger])

  const av = etat?.avancement
  const clientOk = !!av?.signe
  const vehOk = !!av?.vehicule
  return (
    <div className="rounded-2xl border-2 border-blue-300 bg-blue-50 p-4 grid gap-3">
      <div>
        <p className="text-blue-800 text-xs uppercase tracking-widest font-bold"><T k="vabVr.titre" /></p>
        {vr?.plate && <p className="text-gray-900 font-bold text-lg leading-tight">{vr.plate}</p>}
        {vr?.pickup?.name && <p className="text-gray-700 text-sm"><T k="vabVr.prendre" /> : <b className="text-gray-900">{vr.pickup.name}</b></p>}
        {vr?.deliver?.name && <p className="text-gray-700 text-sm"><T k="vabVr.livrer" /> : <b className="text-gray-900">{vr.deliver.name}</b></p>}
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-white border border-blue-200 px-3 py-2"><span className="block text-gray-600 text-xs"><T k="vabVr.client" /></span><b className={clientOk ? 'text-green-700' : 'text-gray-900'}>{clientOk ? <T k="vabVr.fait" /> : <T k="vabVr.aFaire" />}</b></div>
        <div className="rounded-xl bg-white border border-blue-200 px-3 py-2"><span className="block text-gray-600 text-xs"><T k="vabVr.vehicule" /></span><b className={vehOk ? 'text-green-700' : 'text-gray-900'}>{vehOk ? <T k="vabVr.fait" /> : <T k="vabVr.aFaire" />}</b></div>
      </div>
      <button onClick={() => setOuvert(true)} className="w-full min-h-[52px] rounded-xl bg-blue-700 text-white font-bold text-[15px] active:scale-[0.99]">
        🪪 <T k="vabVr.completer" />
      </button>
      {ouvert && <VrContratModal missionId={missionId} initial={etat} onClose={() => { setOuvert(false); charger() }} />}
    </div>
  )
}

function VrContratModal({ missionId, initial, onClose }: { missionId: string; initial: Etat | null; onClose: () => void }) {
  const { t } = useT()
  const [url, setUrl] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [etat, setEtat] = useState<Etat | null>(initial)
  const [veh, setVeh] = useState<any>(initial?.contrat?.vehicule || {})
  const [km, setKm] = useState<string>(initial?.contrat?.vehicule?.km ? String(initial.contrat.vehicule.km) : '')
  const [sauve, setSauve] = useState<'ok' | 'busy' | 'err' | null>(null)
  const kmTimer = useRef<any>(null)

  const ouvrir = useCallback(async () => {
    setErr(null)
    try {
      const r = await fetch(`/api/missions/${missionId}/vr-contrat`, { method: 'POST' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || t('vabVr.erreur'))
      setUrl(j.url); setQr(await QRCode.toDataURL(j.url, { width: 360, margin: 1, errorCorrectionLevel: 'M' }))
    } catch (e: any) { setErr(e.message) }
  }, [missionId, t])

  useEffect(() => {
    ouvrir()
    const iv = setInterval(async () => {
      try { const j = await fetch(`/api/missions/${missionId}/vr-contrat`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null); if (j) setEtat(j) } catch {}
    }, 3000)
    return () => clearInterval(iv)
  }, [missionId, ouvrir])

  const enregistrer = async (patch: any) => {
    setSauve('busy')
    try {
      const r = await fetch(`/api/missions/${missionId}/vr-contrat`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vehicule: patch }) })
      if (!r.ok) throw new Error()
      setSauve('ok')
    } catch { setSauve('err') }
  }
  const choisir = (k: string, v: any) => { setVeh((p: any) => ({ ...p, [k]: v })); enregistrer({ [k]: v }) }
  const saisirKm = (v: string) => {
    const n = v.replace(/\D/g, '').slice(0, 7); setKm(n)
    clearTimeout(kmTimer.current); kmTimer.current = setTimeout(() => enregistrer({ km: n }), 700)
  }

  const av = etat?.avancement
  const c = etat?.contrat
  const complet = c?.status === 'complet'
  const Etape = ({ ok, now, children }: { ok: boolean; now?: boolean; children: React.ReactNode }) => (
    <div className="flex items-center gap-2 text-sm text-gray-800"><span className={`w-3 h-3 rounded-full border-2 ${ok ? 'bg-green-600 border-green-600' : now ? 'bg-amber-400 border-amber-500' : 'border-gray-400'}`} />{children}</div>
  )
  const Choix = ({ k, v, children }: { k: string; v: any; children: React.ReactNode }) => (
    <button type="button" onClick={() => choisir(k, v)} aria-pressed={veh[k] === v}
      className={`min-h-[44px] rounded-xl border-2 px-2 text-sm font-semibold ${veh[k] === v ? 'border-blue-700 bg-blue-700 text-white' : 'border-gray-300 bg-white text-gray-800'}`}>{children}</button>
  )

  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/70 overflow-y-auto px-3 py-4">
      <div className="w-full max-w-md mx-auto bg-white rounded-2xl shadow-xl p-4 grid gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-gray-900 font-bold text-base flex items-center gap-2"><Smartphone size={18} /> <T k="vabVr.qrTitre" /></h3>
          <button onClick={onClose} className="w-11 h-11 flex items-center justify-center text-gray-600" aria-label={t('common.close')}><X size={22} /></button>
        </div>

        {complet ? (
          <p className="rounded-xl bg-green-50 border border-green-300 text-green-800 font-semibold p-3 text-sm"><T k="vabVr.complet" /></p>
        ) : err ? <p className="text-red-700 text-sm font-semibold">⚠ {err}</p>
          : !qr ? <p className="text-gray-700 text-sm py-8 flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> <T k="vabVr.chargement" /></p>
          : (
            <div className="grid gap-3">
              {!av?.signe && <img src={qr} alt="QR" className="mx-auto w-56 h-56 rounded-xl border bg-white" />}
              <p className="text-gray-700 text-sm text-center"><T k="vabVr.qrAide" /></p>
              {url && !av?.signe && (
                <a href={url} target="_blank" rel="noopener" className="min-h-[48px] rounded-xl border-2 border-blue-700 text-blue-800 font-bold text-sm flex items-center justify-center"><T k="vabVr.monTel" /></a>
              )}
              <div className="grid gap-1.5 rounded-xl bg-slate-50 border border-slate-200 p-3">
                <Etape ok={(av?.photos || 0) >= 4} now={(av?.photos || 0) > 0}>{t('vabVr.photos', { n: av?.photos || 0 })}</Etape>
                <Etape ok={!!av?.infos || !!av?.signe}><T k="vabVr.infos" /></Etape>
                <Etape ok={!!av?.signe}><T k="vabVr.signature" /></Etape>
              </div>
              {c?.expire && <p className="text-amber-800 text-sm font-semibold"><T k="vabVr.expire" /></p>}
              {!av?.signe && <p className="text-gray-600 text-xs"><T k="vabVr.attente" /></p>}
            </div>
          )}

        {url && !complet && <div className="grid gap-3 border-t border-gray-200 pt-3">
          <h4 className="text-gray-900 font-bold text-sm"><T k="vabVr.etat" /></h4>
          {(['proprete_int', 'proprete_ext'] as const).map(k => (
            <div key={k} className="grid gap-1.5">
              <span className="text-gray-700 text-[13px] font-semibold"><T k={k === 'proprete_int' ? 'vabVr.propInt' : 'vabVr.propExt'} /></span>
              <div className="grid grid-cols-3 gap-2">{PROPRETES.map(p => <Choix key={p} k={k} v={p}><T k={`vabVr.${p}`} /></Choix>)}</div>
            </div>
          ))}
          <label className="grid gap-1.5">
            <span className="text-gray-700 text-[13px] font-semibold"><T k="vabVr.km" /></span>
            <input value={km} onChange={e => saisirKm(e.target.value)} inputMode="numeric" placeholder="23450"
              className="min-h-[48px] rounded-xl border-2 border-gray-300 bg-white px-3 text-[16px] text-gray-900 outline-none focus:border-blue-600" />
          </label>
          <div className="grid gap-1.5">
            <span className="text-gray-700 text-[13px] font-semibold"><T k="vabVr.carburant" /></span>
            <div className="grid grid-cols-5 gap-1.5">{CARBURANTS.map(n => <Choix key={n} k="carburant" v={n}>{n} %</Choix>)}</div>
          </div>
          <p className="text-xs h-4">
            {sauve === 'busy' && <span className="text-gray-600">…</span>}
            {sauve === 'ok' && <span className="text-green-700 font-semibold">✓ <T k="vabVr.enregistre" /></span>}
            {sauve === 'err' && <span className="text-red-700 font-semibold"><T k="vabVr.erreur" /></span>}
          </p>
        </div>}
      </div>
    </div>,
    document.body,
  )
}
