'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Package, Car, CreditCard, CalendarClock, FileText, ClipboardList,
  KeyRound, PenLine, MapPin, Search, Check, Mail, Phone, X, type LucideIcon,
} from 'lucide-react'

type Motif = { id: string; label: string; label_en: string | null; requires_vehicle: boolean; free_text: boolean }
type Lang = 'fr' | 'en'
type VHit = { id: string; plate: string | null; vehicle: string | null; ref: string | null; zone: string | null }

const RED = '#E11D2E', RED_HOVER = '#C8102E', RED_SOFT = '#FFE5E8'
const INK = '#1F1A17', INK2 = '#4A413C', MUTED = '#8A7F76', LINE = '#EAE5DF'

const T: Record<Lang, Record<string, string>> = {
  fr: {
    welcome: 'Bienvenue chez', sub: 'Enregistrez votre visite en quelques secondes',
    step1: 'Quel est le motif de votre visite ?', vehicle: 'Véhicule concerné',
    vehicleHint: 'Tapez la plaque ou le n° de dossier', searching: 'Recherche…', noHit: 'Aucune fiche trouvée — vous pouvez laisser la plaque telle quelle.',
    identity: 'Vos coordonnées', idHint: 'E-mail ou GSM (au moins un)', email: 'Adresse e-mail', phone: 'Numéro de GSM',
    note: 'Précisions', notePh: 'Une info utile à l’accueil ?',
    submit: 'Je m’enregistre', sending: 'Enregistrement…',
    errMotif: 'Choisissez d’abord un motif.', errId: 'Indiquez un e-mail ou un GSM.', errNet: 'Erreur réseau, réessayez.',
    doneT: 'C’est noté, merci !', doneM: 'Vous êtes enregistré. Un membre de l’équipe va vous recevoir — installez-vous confortablement.',
    again: 'Terminer',
  },
  en: {
    welcome: 'Welcome to', sub: 'Check in your visit in seconds',
    step1: 'What brings you in today?', vehicle: 'Vehicle concerned',
    vehicleHint: 'Type the plate or file number', searching: 'Searching…', noHit: 'No record found — you can leave the plate as is.',
    identity: 'Your contact details', idHint: 'Email or mobile (at least one)', email: 'Email address', phone: 'Mobile number',
    note: 'Details', notePh: 'Anything useful for the desk?',
    submit: 'Check me in', sending: 'Checking in…',
    errMotif: 'Please select a reason first.', errId: 'Please provide an email or mobile.', errNet: 'Network error, try again.',
    doneT: 'All set, thank you!', doneM: 'You are checked in. A team member will see you shortly — please take a seat.',
    again: 'Finish',
  },
}

function motifIcon(label: string): LucideIcon {
  const s = label.toLowerCase()
  if (/remplacement|\bvr\b/.test(s))                    return KeyRound
  if (/saisie|seiz/.test(s))                            return ClipboardList
  if (/effet|récup|recup|collect|belong|reprend/.test(s)) return Package
  if (/facture|paiement|payment|restit|caisse/.test(s)) return CreditCard
  if (/rendez|appointment|\brdv\b/.test(s))             return CalendarClock
  if (/admin/.test(s))                                  return FileText
  if (/véhicul|vehicul|vehicle|voiture|voir|see|car/.test(s)) return Car
  if (/autre|other/.test(s))                            return PenLine
  return MapPin
}

export default function AccueilClient() {
  const [lang, setLang]     = useState<Lang>('fr')
  const [motifs, setMotifs] = useState<Motif[]>([])
  const [sel, setSel]       = useState<Motif | null>(null)
  const [vehicle, setVehicle] = useState('')
  const [vHits, setVHits]   = useState<VHit[]>([])
  const [vLoading, setVLoading] = useState(false)
  const [vPicked, setVPicked]   = useState<VHit | null>(null)
  const [email, setEmail]   = useState('')
  const [phone, setPhone]   = useState('')
  const [note, setNote]     = useState('')
  const [busy, setBusy]     = useState(false)
  const [err, setErr]       = useState('')
  const [done, setDone]     = useState(false)
  const t = T[lang]
  const debRef = useRef<any>(null)

  useEffect(() => {
    fetch('/api/reception/motifs', { cache: 'no-store' })
      .then(r => r.json()).then(j => setMotifs(j.motifs || [])).catch(() => {})
  }, [])

  // Autocomplétion plaque → recherche fiche VD Soft.
  useEffect(() => {
    if (vPicked) return
    const q = vehicle.trim()
    if (q.length < 2) { setVHits([]); setVLoading(false); return }
    setVLoading(true)
    clearTimeout(debRef.current)
    debRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/reception/vehicle-search?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
        const j = await r.json()
        setVHits(j.results || [])
      } catch { setVHits([]) } finally { setVLoading(false) }
    }, 280)
    return () => clearTimeout(debRef.current)
  }, [vehicle, vPicked])

  const mLabel = (m: Motif) => (lang === 'en' && m.label_en ? m.label_en : m.label)

  function pickVehicle(h: VHit) { setVPicked(h); setVehicle(h.plate || ''); setVHits([]) }
  function clearVehicle() { setVPicked(null); setVehicle(''); setVHits([]) }

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
          vehicle: sel.requires_vehicle ? (vPicked?.plate || vehicle.trim()) : '',
          email: email.trim(), phone: phone.trim(), note: note.trim(),
        }),
      })
      const j = await r.json()
      if (!r.ok) { setErr(j.error || t.errNet); return }
      setDone(true)
    } catch { setErr(t.errNet) } finally { setBusy(false) }
  }

  function reset() {
    setSel(null); clearVehicle(); setEmail(''); setPhone(''); setNote(''); setErr(''); setDone(false)
  }

  /* ---------- Confirmation ---------- */
  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6"
        style={{ background: 'linear-gradient(180deg,#FAF8F6 0%,#F5F2EE 100%)' }}>
        <div className="w-full max-w-md bg-white rounded-3xl p-10 text-center shadow-xl" style={{ border: `1px solid ${LINE}` }}>
          <div className="mx-auto w-24 h-24 rounded-full flex items-center justify-center motion-safe:animate-[pop_.5s_ease]"
            style={{ background: '#EAF7EE' }}>
            <Check className="w-12 h-12" style={{ color: '#1B9E4B' }} strokeWidth={3} />
          </div>
          <h2 className="mt-6 text-3xl font-black tracking-tight" style={{ color: INK }}>{t.doneT}</h2>
          <p className="mt-3 text-[17px] leading-relaxed" style={{ color: INK2 }}>{t.doneM}</p>
          <button onClick={reset}
            className="mt-8 w-full py-3.5 rounded-2xl font-bold text-white text-lg active:scale-[.99] transition"
            style={{ background: INK }}>{t.again}</button>
        </div>
        <style>{`@keyframes pop{0%{transform:scale(.5);opacity:0}60%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}`}</style>
      </div>
    )
  }

  const ready = !!sel && (!!email.trim() || !!phone.trim())

  return (
    <div className="min-h-screen py-6 px-4 flex justify-center" style={{ background: 'linear-gradient(180deg,#FAF8F6 0%,#F1ECE6 100%)' }}>
      <div className="w-full max-w-2xl">
        <div className="bg-white rounded-3xl overflow-hidden shadow-xl" style={{ border: `1px solid ${LINE}` }}>
          {/* Accent + en-tête */}
          <div style={{ height: 5, background: `linear-gradient(90deg,${RED},${RED_HOVER})` }} />
          <header className="px-6 sm:px-8 pt-6 pb-5 flex items-center justify-between gap-4" style={{ borderBottom: `1px solid ${LINE}` }}>
            <div className="flex items-center gap-3.5 min-w-0">
              <img src="/logo.png" alt="Verviers Dépannage" className="w-14 h-14 rounded-2xl object-cover flex-shrink-0"
                style={{ border: `1px solid ${LINE}` }} />
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wider" style={{ color: RED }}>{t.welcome}</p>
                <h1 className="text-xl sm:text-2xl font-black leading-tight truncate" style={{ color: INK }}>Verviers Dépannage</h1>
              </div>
            </div>
            <div className="flex gap-1 rounded-2xl p-1 flex-shrink-0" style={{ background: '#F5F1EC' }}>
              {(['fr', 'en'] as Lang[]).map(l => (
                <button key={l} onClick={() => setLang(l)}
                  className="px-3.5 py-1.5 rounded-xl text-sm font-extrabold transition"
                  style={lang === l ? { background: '#fff', color: RED, boxShadow: '0 1px 3px rgba(0,0,0,.08)' } : { color: MUTED }}>
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          </header>

          <div className="px-6 sm:px-8 py-6 space-y-7">
            <p className="text-[15px] -mt-1" style={{ color: INK2 }}>{t.sub}</p>

            {/* Motifs */}
            <section>
              <h2 className="font-extrabold text-lg mb-3" style={{ color: INK }}>{t.step1}</h2>
              <div className="grid grid-cols-2 gap-3">
                {motifs.map(m => {
                  const on = sel?.id === m.id
                  const Icon = motifIcon(m.label)
                  return (
                    <button key={m.id} onClick={() => setSel(m)}
                      className="relative text-left rounded-2xl p-4 flex flex-col gap-2.5 transition active:scale-[.98]"
                      style={{
                        border: `2px solid ${on ? RED : LINE}`,
                        background: on ? RED_SOFT : '#fff',
                      }}>
                      <span className="w-10 h-10 rounded-xl flex items-center justify-center"
                        style={{ background: on ? '#fff' : RED_SOFT }}>
                        <Icon className="w-5 h-5" style={{ color: RED }} strokeWidth={2.2} />
                      </span>
                      <span className="font-bold text-[15px] leading-snug" style={{ color: on ? RED_HOVER : INK }}>{mLabel(m)}</span>
                      {on && <span className="absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center" style={{ background: RED }}>
                        <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} /></span>}
                    </button>
                  )
                })}
                {!motifs.length && Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="rounded-2xl h-28 animate-pulse" style={{ background: '#F5F1EC' }} />
                ))}
              </div>
            </section>

            {/* Véhicule + autocomplétion */}
            {sel?.requires_vehicle && (
              <section>
                <h2 className="font-extrabold text-lg" style={{ color: INK }}>{t.vehicle}</h2>
                <p className="text-sm mb-2.5" style={{ color: MUTED }}>{t.vehicleHint}</p>
                {vPicked ? (
                  <div className="flex items-center gap-3 rounded-2xl px-4 py-3.5" style={{ background: RED_SOFT, border: `2px solid ${RED}` }}>
                    <Car className="w-5 h-5 flex-shrink-0" style={{ color: RED }} />
                    <div className="flex-1 min-w-0">
                      <div className="font-extrabold tracking-wide" style={{ color: INK }}>{vPicked.plate || '—'}</div>
                      <div className="text-sm truncate" style={{ color: INK2 }}>
                        {[vPicked.vehicle, vPicked.ref, vPicked.zone ? `Zone ${vPicked.zone}` : null].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <button onClick={clearVehicle} className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: '#fff' }}>
                      <X className="w-4 h-4" style={{ color: MUTED }} />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: MUTED }} />
                    <input value={vehicle} onChange={e => setVehicle(e.target.value)} placeholder="1-ABC-234"
                      className="w-full pl-12 pr-4 py-4 rounded-2xl text-lg font-semibold tracking-wide uppercase focus:outline-none transition"
                      style={{ border: `2px solid ${LINE}`, background: '#FBFAF8', color: INK }}
                      onFocus={e => (e.currentTarget.style.borderColor = RED)}
                      onBlur={e => (e.currentTarget.style.borderColor = LINE)} />
                    {(vLoading || vHits.length > 0 || (vehicle.trim().length >= 2 && !vLoading)) && (
                      <div className="mt-2 rounded-2xl overflow-hidden" style={{ border: `1px solid ${LINE}` }}>
                        {vLoading && <div className="px-4 py-3 text-sm" style={{ color: MUTED }}>{t.searching}</div>}
                        {!vLoading && vHits.map(h => (
                          <button key={h.id} onClick={() => pickVehicle(h)}
                            className="w-full flex items-center gap-3 px-4 py-3 text-left transition hover:bg-[#F5F1EC]" style={{ borderTop: `1px solid ${LINE}` }}>
                            <Car className="w-4 h-4 flex-shrink-0" style={{ color: RED }} />
                            <span className="font-bold tracking-wide" style={{ color: INK }}>{h.plate || '—'}</span>
                            <span className="text-sm truncate" style={{ color: INK2 }}>{[h.vehicle, h.ref].filter(Boolean).join(' · ')}</span>
                          </button>
                        ))}
                        {!vLoading && vHits.length === 0 && (
                          <div className="px-4 py-3 text-sm" style={{ color: MUTED }}>{t.noHit}</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {/* Identité */}
            {sel && (
              <section>
                <h2 className="font-extrabold text-lg" style={{ color: INK }}>{t.identity}</h2>
                <p className="text-sm mb-2.5" style={{ color: MUTED }}>{t.idHint}</p>
                <div className="space-y-3">
                  {[{ icon: Mail, v: email, set: setEmail, ph: t.email, type: 'email' },
                    { icon: Phone, v: phone, set: setPhone, ph: t.phone, type: 'tel' }].map((f, i) => {
                    const Icon = f.icon
                    return (
                      <div key={i} className="relative">
                        <Icon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: MUTED }} />
                        <input value={f.v} onChange={e => f.set(e.target.value)} type={f.type} placeholder={f.ph}
                          className="w-full pl-12 pr-4 py-4 rounded-2xl text-lg focus:outline-none transition"
                          style={{ border: `2px solid ${LINE}`, background: '#FBFAF8', color: INK }}
                          onFocus={e => (e.currentTarget.style.borderColor = RED)}
                          onBlur={e => (e.currentTarget.style.borderColor = LINE)} />
                      </div>
                    )
                  })}
                </div>

                {sel.free_text && (
                  <div className="mt-3">
                    <label className="block font-bold text-sm mb-1.5" style={{ color: INK }}>{t.note}</label>
                    <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder={t.notePh}
                      className="w-full px-4 py-3 rounded-2xl text-base focus:outline-none transition"
                      style={{ border: `2px solid ${LINE}`, background: '#FBFAF8', color: INK }}
                      onFocus={e => (e.currentTarget.style.borderColor = RED)}
                      onBlur={e => (e.currentTarget.style.borderColor = LINE)} />
                  </div>
                )}
              </section>
            )}

            {err && (
              <div className="flex items-center gap-2 rounded-2xl px-4 py-3 font-semibold"
                style={{ background: RED_SOFT, color: RED_HOVER, border: `1px solid ${RED}` }}>⚠ {err}</div>
            )}

            <button onClick={submit} disabled={busy || !ready}
              className="w-full py-4 rounded-2xl font-black text-xl text-white active:scale-[.99] transition"
              style={{ background: (busy || !ready) ? '#C9C1B8' : RED, boxShadow: (busy || !ready) ? 'none' : '0 6px 18px rgba(225,29,46,.28)' }}
              onMouseDown={e => { if (!(busy || !ready)) e.currentTarget.style.background = RED_HOVER }}
              onMouseUp={e => { if (!(busy || !ready)) e.currentTarget.style.background = RED }}>
              {busy ? t.sending : t.submit}
            </button>
          </div>
        </div>
        <p className="text-center text-xs mt-4" style={{ color: MUTED }}>Verviers Dépannage · Accueil visiteur</p>
      </div>
    </div>
  )
}
