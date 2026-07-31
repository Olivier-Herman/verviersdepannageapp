'use client'

import { useEffect, useState } from 'react'

type Motif = { id: string; label: string; label_en: string | null; requires_vehicle: boolean; free_text: boolean }
type Lang = 'fr' | 'en'

const T: Record<Lang, Record<string, string>> = {
  fr: {
    welcome: 'Bienvenue', title: 'Verviers Dépannage', sub: 'Enregistrez votre visite en quelques secondes',
    step1: 'Quel est le motif de votre visite ?', vehicle: 'Véhicule concerné', vehicleHint: 'Plaque ou n° de dossier',
    identity: 'Vos coordonnées', idHint: 'E-mail ou GSM — au moins un', email: 'Adresse e-mail', phone: 'Numéro de GSM',
    note: 'Précisions', notePh: 'Une info utile à l’accueil ?',
    submit: 'Je m’enregistre', sending: 'Enregistrement…',
    errMotif: 'Choisissez d’abord un motif.', errId: 'Indiquez un e-mail ou un GSM.', errNet: 'Erreur réseau, réessayez.',
    doneT: 'C’est noté, merci !', doneM: 'Vous êtes enregistré. Un membre de l’équipe va vous recevoir — installez-vous confortablement.',
    again: 'Terminer',
  },
  en: {
    welcome: 'Welcome', title: 'Verviers Dépannage', sub: 'Check in your visit in seconds',
    step1: 'What brings you in today?', vehicle: 'Vehicle concerned', vehicleHint: 'Plate or file number',
    identity: 'Your contact details', idHint: 'Email or mobile — at least one', email: 'Email address', phone: 'Mobile number',
    note: 'Details', notePh: 'Anything useful for the desk?',
    submit: 'Check me in', sending: 'Checking in…',
    errMotif: 'Please select a reason first.', errId: 'Please provide an email or mobile.', errNet: 'Network error, try again.',
    doneT: 'All set, thank you!', doneM: 'You are checked in. A team member will see you shortly — please take a seat.',
    again: 'Finish',
  },
}

// Petite icône selon le libellé (fallback neutre) — purement décoratif.
function motifIcon(label: string): string {
  const s = label.toLowerCase()
  if (/effet|belong|récup|collect|reprend/.test(s)) return '📦'
  if (/véhicul|vehicle|voir|see|voiture/.test(s))   return '🚗'
  if (/paiement|payment|restit|release|caisse/.test(s)) return '💳'
  if (/rendez|appointment|rdv/.test(s))             return '📅'
  if (/admin/.test(s))                              return '📄'
  if (/autre|other/.test(s))                        return '✏️'
  return '📍'
}

export default function AccueilClient() {
  const [lang, setLang]     = useState<Lang>('fr')
  const [motifs, setMotifs] = useState<Motif[]>([])
  const [sel, setSel]       = useState<Motif | null>(null)
  const [vehicle, setVehicle] = useState('')
  const [email, setEmail]   = useState('')
  const [phone, setPhone]   = useState('')
  const [note, setNote]     = useState('')
  const [busy, setBusy]     = useState(false)
  const [err, setErr]       = useState('')
  const [done, setDone]     = useState(false)
  const t = T[lang]

  useEffect(() => {
    fetch('/api/reception/motifs', { cache: 'no-store' })
      .then(r => r.json()).then(j => setMotifs(j.motifs || [])).catch(() => {})
  }, [])

  const mLabel = (m: Motif) => (lang === 'en' && m.label_en ? m.label_en : m.label)

  async function submit() {
    setErr('')
    if (!sel) { setErr(t.errMotif); return }
    if (!email.trim() && !phone.trim()) { setErr(t.errId); return }
    setBusy(true)
    try {
      const r = await fetch('/api/reception/checkin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lang, motif_id: sel.id,
          vehicle: sel.requires_vehicle ? vehicle.trim() : '',
          email: email.trim(), phone: phone.trim(), note: note.trim(),
        }),
      })
      const j = await r.json()
      if (!r.ok) { setErr(j.error || t.errNet); return }
      setDone(true)
    } catch { setErr(t.errNet) } finally { setBusy(false) }
  }

  function reset() {
    setSel(null); setVehicle(''); setEmail(''); setPhone(''); setNote(''); setErr(''); setDone(false)
  }

  /* ---------- Écran de confirmation ---------- */
  if (done) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
        style={{ background: 'radial-gradient(1200px 600px at 50% -10%, #dbeafe 0%, #f8fafc 55%)' }}>
        <div className="motion-safe:animate-[pop_.5s_ease] w-28 h-28 rounded-full bg-emerald-500 text-white flex items-center justify-center text-6xl shadow-xl shadow-emerald-500/30">✓</div>
        <h2 className="mt-7 text-4xl font-black text-slate-900 tracking-tight">{t.doneT}</h2>
        <p className="mt-3 text-lg text-slate-600 max-w-md leading-relaxed">{t.doneM}</p>
        <button onClick={reset}
          className="mt-9 px-8 py-3.5 bg-slate-900 text-white rounded-2xl font-bold text-lg active:scale-95 transition">{t.again}</button>
        <style>{`@keyframes pop{0%{transform:scale(.5);opacity:0}60%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}}`}</style>
      </div>
    )
  }

  const ready = !!sel && (!!email.trim() || !!phone.trim()) && (!sel.requires_vehicle || !!vehicle.trim() || true)

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* En-tête de marque */}
      <header className="relative overflow-hidden text-white px-6 pt-8 pb-14"
        style={{ background: 'linear-gradient(135deg, #1d4ed8 0%, #1e3a8a 60%, #172554 100%)' }}>
        <div className="absolute -top-16 -right-10 w-56 h-56 rounded-full bg-white/10" />
        <div className="absolute -bottom-24 -left-10 w-64 h-64 rounded-full bg-white/5" />
        <div className="relative max-w-xl mx-auto">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center text-2xl">🛞</div>
              <div>
                <p className="text-blue-200 text-sm font-semibold tracking-wide">{t.welcome}</p>
                <h1 className="text-2xl font-black leading-tight">{t.title}</h1>
              </div>
            </div>
            <div className="flex gap-1 bg-white/15 backdrop-blur rounded-2xl p-1">
              {(['fr', 'en'] as Lang[]).map(l => (
                <button key={l} onClick={() => setLang(l)}
                  className={`px-3.5 py-1.5 rounded-xl text-sm font-extrabold transition ${lang === l ? 'bg-white text-blue-800 shadow' : 'text-white/80'}`}>
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-4 text-blue-100 text-[15px]">{t.sub}</p>
        </div>
      </header>

      {/* Contenu */}
      <main className="flex-1 w-full max-w-xl mx-auto px-5 -mt-8 pb-10 space-y-5">
        {/* Motifs */}
        <section className="bg-white rounded-3xl shadow-sm border border-slate-100 p-5">
          <h2 className="text-slate-900 font-bold text-lg mb-3">{t.step1}</h2>
          <div className="grid grid-cols-2 gap-3">
            {motifs.map(m => {
              const on = sel?.id === m.id
              return (
                <button key={m.id} onClick={() => setSel(m)}
                  className={`relative text-left rounded-2xl border-2 p-4 transition active:scale-[.98] ${on ? 'border-blue-600 bg-blue-50 shadow-sm' : 'border-slate-150 bg-slate-50 hover:border-blue-300'}`}
                  style={{ borderColor: on ? '#2563eb' : '#e8edf5' }}>
                  <div className="text-2xl mb-1.5">{motifIcon(m.label)}</div>
                  <div className={`font-bold text-[15px] leading-snug ${on ? 'text-blue-800' : 'text-slate-800'}`}>{mLabel(m)}</div>
                  {on && <span className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs">✓</span>}
                </button>
              )
            })}
            {!motifs.length && Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-2xl border-2 border-slate-100 bg-slate-50 p-4 h-24 animate-pulse" />
            ))}
          </div>
        </section>

        {/* Véhicule */}
        {sel?.requires_vehicle && (
          <section className="bg-white rounded-3xl shadow-sm border border-slate-100 p-5">
            <h2 className="text-slate-900 font-bold text-lg">{t.vehicle}</h2>
            <p className="text-slate-400 text-sm mb-3">{t.vehicleHint}</p>
            <input value={vehicle} onChange={e => setVehicle(e.target.value)} placeholder="1-ABC-234"
              className="w-full px-4 py-4 rounded-2xl border-2 border-slate-200 bg-slate-50 text-lg font-semibold tracking-wide uppercase focus:border-blue-500 focus:bg-white focus:outline-none transition" />
          </section>
        )}

        {/* Identité */}
        {sel && (
          <section className="bg-white rounded-3xl shadow-sm border border-slate-100 p-5">
            <h2 className="text-slate-900 font-bold text-lg">{t.identity}</h2>
            <p className="text-slate-400 text-sm mb-3">{t.idHint}</p>
            <div className="space-y-3">
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-lg">✉️</span>
                <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder={t.email}
                  className="w-full pl-12 pr-4 py-4 rounded-2xl border-2 border-slate-200 bg-slate-50 text-lg focus:border-blue-500 focus:bg-white focus:outline-none transition" />
              </div>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-lg">📱</span>
                <input value={phone} onChange={e => setPhone(e.target.value)} type="tel" placeholder={t.phone}
                  className="w-full pl-12 pr-4 py-4 rounded-2xl border-2 border-slate-200 bg-slate-50 text-lg focus:border-blue-500 focus:bg-white focus:outline-none transition" />
              </div>
            </div>

            {sel.free_text && (
              <div className="mt-3">
                <label className="block text-slate-900 font-bold text-sm mb-1.5">{t.note}</label>
                <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder={t.notePh}
                  className="w-full px-4 py-3 rounded-2xl border-2 border-slate-200 bg-slate-50 text-base focus:border-blue-500 focus:bg-white focus:outline-none transition" />
              </div>
            )}
          </section>
        )}

        {err && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-2xl px-4 py-3 font-semibold">
            <span>⚠</span> {err}
          </div>
        )}

        {/* CTA */}
        <button onClick={submit} disabled={busy || !ready}
          className="w-full py-4.5 rounded-2xl font-black text-xl text-white shadow-lg shadow-blue-600/25 active:scale-[.99] transition disabled:opacity-40 disabled:shadow-none"
          style={{ padding: '1.05rem', background: (busy || !ready) ? '#94a3b8' : 'linear-gradient(135deg,#2563eb,#1e40af)' }}>
          {busy ? t.sending : t.submit}
        </button>
        <p className="text-center text-slate-400 text-xs pb-2">Verviers Dépannage · Accueil</p>
      </main>
    </div>
  )
}
