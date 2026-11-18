'use client'
// Appel police lancé par le dispatch (Olivier 18/11/2026, maquette 3Ck3brtnWpsu2tZm6gQqDL validée avec ses réponses) :
// le dispatch donne l'adresse et le chauffeur ; le chauffeur accepte, voit l'adresse, puis remplit son formulaire de
// création habituel (motif choisi par lui sur place). Pas de rappel ni d'appel automatique.
import { useCallback, useEffect, useState } from 'react'
import AddressField from '@/components/AddressField'

const GM_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''
type Chauffeur = { id: string; nom: string; eta_min: number | null; occupe: boolean; raison: string }
type Appel = { id: string; address: string; status: string; created_at: string; accepted_at: string | null; driver_name: string | null; note: string | null }
const heure = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }).replace(':', ' h ') : ''

export function AppelPoliceBouton({ onEnvoye, className }: { onEnvoye?: () => void; className?: string }) {
  const [ouvert, setOuvert] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOuvert(true)} className={className || 'min-h-[44px] px-4 rounded-xl bg-red-700 text-white font-bold text-sm'}>🚓 Appel police</button>
      {ouvert && <AppelPoliceFenetre onFermer={() => setOuvert(false)} onEnvoye={() => { setOuvert(false); onEnvoye?.(); window.dispatchEvent(new Event('vd-appels-police')) }} />}
    </>
  )
}

function AppelPoliceFenetre({ onFermer, onEnvoye }: { onFermer: () => void; onEnvoye: () => void }) {
  const [adresse, setAdresse] = useState('')
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null)
  const [chauffeurs, setChauffeurs] = useState<Chauffeur[] | null>(null)
  const [tous, setTous] = useState(false)
  const [choix, setChoix] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!pos && !tous) { setChauffeurs(null); return }
    setChauffeurs(null)
    const q = tous ? 'tous=1' : `lat=${pos!.lat}&lng=${pos!.lng}`
    fetch(`/api/appels-police/chauffeurs?${q}`, { cache: 'no-store' }).then(r => r.json()).then(j => {
      const l: Chauffeur[] = j.chauffeurs || []
      setChauffeurs(l)
      if (!tous && l[0]?.eta_min != null) setChoix(c => c || l[0].id)
    }).catch(() => setChauffeurs([]))
  }, [pos, tous])
  const nomChoisi = chauffeurs?.find(c => c.id === choix)?.nom
  const envoyer = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/appels-police', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: adresse, lat: pos?.lat, lng: pos?.lng, driver_id: choix, note }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || 'Envoi impossible'); return }
      onEnvoye()
    } catch { setErr('Erreur réseau') } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-[300] bg-black/60 flex items-start sm:items-center justify-center p-3 overflow-y-auto">
      <div className="w-full max-w-lg rounded-2xl bg-white border-2 border-red-700 shadow-2xl p-4 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-extrabold text-stone-900 mr-auto">🚓 Appel police</h2>
          <button type="button" onClick={onFermer} aria-label="Fermer" className="w-11 h-11 rounded-xl border border-stone-300 text-stone-800 text-lg">✕</button>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-bold text-stone-800">Où ?</span>
          <AddressField value={adresse} onChange={v => { setAdresse(v); setPos(null) }} onSelect={(a, la, ln) => { setAdresse(a); setPos({ lat: la, lng: ln }) }} gmKey={GM_KEY} placeholder="Adresse de l’appel" />
          {adresse && !pos && <span className="text-[12.5px] text-amber-800">Choisissez l’adresse dans les suggestions pour voir les chauffeurs les plus proches.</span>}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-stone-800">Qui y va ?</span>
          {!pos && !tous && <span className="text-sm text-stone-600">Les chauffeurs apparaissent dès que l’adresse est choisie.</span>}
          {(pos || tous) && chauffeurs === null && <span className="text-sm text-stone-600">Calcul des trajets…</span>}
          {chauffeurs && chauffeurs.length === 0 && <span className="text-sm text-stone-600">Aucun chauffeur en service trouvé.</span>}
          {chauffeurs?.map((c, i) => (
            <button key={c.id} type="button" onClick={() => setChoix(c.id)}
              className={`min-h-[48px] rounded-xl border px-3 py-2 text-left flex items-center gap-2 ${choix === c.id ? 'border-2 border-emerald-700 bg-emerald-50' : 'border-stone-300 bg-white'}`}>
              <span className="font-bold text-stone-900 mr-auto">{c.nom}</span>
              <span className="text-[12.5px] text-stone-700 text-right">{c.eta_min != null ? `${c.eta_min} min` : ''}{c.raison ? <span className="block text-stone-500">{c.raison}</span> : null}</span>
              {!tous && i === 0 && c.eta_min != null && <span className="text-[11px] font-bold rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5">proposé</span>}
            </button>
          ))}
          <button type="button" onClick={() => setTous(t => !t)} className="min-h-[44px] text-sm text-stone-700 underline self-start">{tous ? 'Revenir aux chauffeurs les plus proches' : 'Voir tous les chauffeurs'}</button>
        </div>
        <label className="flex flex-col gap-1 text-sm font-bold text-stone-800">Un mot pour le chauffeur (facultatif)
          <input value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="ex. : la police attend sur place" className="min-h-[46px] rounded-xl border border-stone-300 px-3 font-normal text-stone-900" />
        </label>
        {err && <p className="text-sm font-semibold text-red-800">{err}</p>}
        <button type="button" disabled={busy || !adresse.trim() || !choix} onClick={envoyer} className="min-h-[48px] rounded-xl bg-red-700 text-white font-bold disabled:opacity-50">
          {busy ? 'Envoi…' : nomChoisi ? `Envoyer à ${nomChoisi}` : 'Choisissez le chauffeur'}
        </button>
      </div>
    </div>
  )
}

/** Appels police envoyés par le dispatch, pas encore complétés par le chauffeur. Rien si la liste est vide. */
export function AppelsPoliceEnCours() {
  const [appels, setAppels] = useState<Appel[]>([])
  const charger = useCallback(() => { fetch('/api/appels-police', { cache: 'no-store' }).then(r => r.ok ? r.json() : { appels: [] }).then(j => setAppels(j.appels || [])).catch(() => {}) }, [])
  useEffect(() => { charger(); const t = setInterval(charger, 20000); const h = () => charger(); window.addEventListener('vd-appels-police', h); return () => { clearInterval(t); window.removeEventListener('vd-appels-police', h) } }, [charger])
  const [aAnnuler, setAAnnuler] = useState<string | null>(null)
  if (!appels.length) return null
  return (
    <div className="flex flex-col gap-1.5">
      {appels.map(a => (
        <div key={a.id} className="rounded-xl border-2 border-red-200 bg-red-50 px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[11px] font-bold rounded-full bg-red-700 text-white px-2 py-0.5">Appel police</span>
          <span className="font-semibold text-stone-900 min-w-0 break-words">{a.address}</span>
          <span className="text-stone-800">{a.driver_name || '?'}</span>
          {a.status === 'accepte'
            ? <span className="text-[12px] font-bold rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5">accepté à {heure(a.accepted_at)} · à compléter par le chauffeur</span>
            : <span className="text-[12px] font-bold rounded-full bg-amber-100 text-amber-900 px-2 py-0.5">envoyé à {heure(a.created_at)} · pas encore accepté</span>}
          {aAnnuler === a.id
            ? <span className="ml-auto flex gap-2"><button type="button" className="min-h-[40px] px-3 rounded-lg bg-red-700 text-white text-sm font-bold" onClick={async () => { await fetch(`/api/appels-police/${a.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'annuler' }) }); setAAnnuler(null); charger() }}>Oui, annuler</button><button type="button" className="min-h-[40px] px-3 rounded-lg border border-stone-300 text-sm" onClick={() => setAAnnuler(null)}>Non</button></span>
            : <button type="button" className="ml-auto min-h-[40px] px-3 rounded-lg border border-stone-300 bg-white text-sm text-stone-800" onClick={() => setAAnnuler(a.id)}>Annuler l’appel</button>}
        </div>
      ))}
    </div>
  )
}
