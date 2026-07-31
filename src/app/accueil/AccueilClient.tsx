'use client'

import { useEffect, useState } from 'react'

type Motif = { id: string; label: string; label_en: string | null; requires_vehicle: boolean; free_text: boolean }
type Lang = 'fr' | 'en'

const T: Record<Lang, Record<string, string>> = {
  fr: {
    title: 'Accueil visiteur', sub: 'Enregistrez votre visite',
    motif: 'Motif de votre visite', vehicle: 'Véhicule concerné (plaque ou n° de dossier)',
    identity: 'Vos coordonnées', email: 'Adresse e-mail', phone: 'Numéro de GSM',
    idHint: 'E-mail ou GSM (au moins un)', note: 'Précisions (optionnel)',
    submit: 'Valider', sending: 'Envoi…',
    errMotif: 'Choisissez un motif.', errId: 'Indiquez un e-mail ou un GSM.', errNet: 'Erreur réseau, réessayez.',
    doneT: 'Merci !', doneM: 'Vous êtes enregistré dans la file — un membre de l’équipe va vous recevoir.',
    again: 'Nouvelle visite', optional: '(optionnel)',
  },
  en: {
    title: 'Visitor check-in', sub: 'Register your visit',
    motif: 'Reason for your visit', vehicle: 'Vehicle (plate or file number)',
    identity: 'Your contact details', email: 'Email address', phone: 'Mobile number',
    idHint: 'Email or mobile (at least one)', note: 'Details (optional)',
    submit: 'Submit', sending: 'Sending…',
    errMotif: 'Please select a reason.', errId: 'Please provide an email or mobile.', errNet: 'Network error, try again.',
    doneT: 'Thank you!', doneM: 'You are registered — a team member will see you shortly.',
    again: 'New visit', optional: '(optional)',
  },
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
          email: email.trim(), phone: phone.trim(),
          note: sel.free_text ? note.trim() : note.trim(),
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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* header + langue */}
      <header className="flex items-center justify-between px-5 py-4 border-b bg-white">
        <div>
          <h1 className="text-xl font-extrabold">🪪 {t.title}</h1>
          <p className="text-slate-500 text-sm">{t.sub}</p>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {(['fr', 'en'] as Lang[]).map(l => (
            <button key={l} onClick={() => setLang(l)}
              className={`px-3 py-1.5 rounded-lg text-sm font-bold ${lang === l ? 'bg-blue-600 text-white' : 'text-slate-600'}`}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      {done ? (
        <main className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-5">
          <div className="text-7xl">✓</div>
          <h2 className="text-3xl font-extrabold text-emerald-600">{t.doneT}</h2>
          <p className="text-lg text-slate-600 max-w-md">{t.doneM}</p>
          <button onClick={reset} className="mt-4 px-6 py-3 bg-blue-600 text-white rounded-2xl font-bold text-lg">{t.again}</button>
        </main>
      ) : (
        <main className="flex-1 w-full max-w-xl mx-auto px-5 py-6 space-y-6">
          {/* Motifs */}
          <section>
            <h2 className="text-slate-500 text-xs font-bold uppercase tracking-wide mb-2">{t.motif}</h2>
            <div className="grid grid-cols-2 gap-3">
              {motifs.map(m => (
                <button key={m.id} onClick={() => setSel(m)}
                  className={`text-left px-4 py-4 rounded-2xl border-2 font-semibold text-base transition ${sel?.id === m.id ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-800'}`}>
                  {mLabel(m)}
                </button>
              ))}
              {!motifs.length && <p className="text-slate-400 text-sm col-span-2">…</p>}
            </div>
          </section>

          {sel?.requires_vehicle && (
            <section>
              <h2 className="text-slate-500 text-xs font-bold uppercase tracking-wide mb-2">{t.vehicle}</h2>
              <input value={vehicle} onChange={e => setVehicle(e.target.value)} placeholder="1ABC234"
                className="w-full px-4 py-3.5 rounded-2xl border-2 border-slate-200 bg-white text-lg" />
            </section>
          )}

          {sel && (
            <>
              <section>
                <h2 className="text-slate-500 text-xs font-bold uppercase tracking-wide mb-2">{t.identity} <span className="text-slate-400 font-medium normal-case">— {t.idHint}</span></h2>
                <div className="space-y-3">
                  <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder={t.email}
                    className="w-full px-4 py-3.5 rounded-2xl border-2 border-slate-200 bg-white text-lg" />
                  <input value={phone} onChange={e => setPhone(e.target.value)} type="tel" placeholder={t.phone}
                    className="w-full px-4 py-3.5 rounded-2xl border-2 border-slate-200 bg-white text-lg" />
                </div>
              </section>

              {sel.free_text && (
                <section>
                  <h2 className="text-slate-500 text-xs font-bold uppercase tracking-wide mb-2">{t.note}</h2>
                  <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
                    className="w-full px-4 py-3 rounded-2xl border-2 border-slate-200 bg-white text-base" />
                </section>
              )}
            </>
          )}

          {err && <p className="text-red-600 font-semibold text-center">⚠ {err}</p>}

          <button onClick={submit} disabled={busy || !sel}
            className="w-full py-4 bg-blue-600 text-white rounded-2xl font-extrabold text-xl disabled:opacity-40">
            {busy ? t.sending : t.submit}
          </button>
        </main>
      )}
    </div>
  )
}
