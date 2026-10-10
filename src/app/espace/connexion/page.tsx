'use client'
import { useEffect, useRef, useState } from 'react'
import { Depanneuse } from '../_ui/illustrations'

type Etape = 'email' | 'code' | 'mdp'

export default function Connexion() {
  const [etape, setEtape] = useState<Etape>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState(['', '', '', '', '', ''])
  const [mdp, setMdp] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const refs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => { const e = new URLSearchParams(location.search).get('email'); if (e) setEmail(e) }, [])

  const post = async (body: any) => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/espace/connexion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, ...body }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Erreur')
      return true
    } catch (e: any) { setErr(e.message); return false } finally { setBusy(false) }
  }
  const demanderCode = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setErr('Indiquez votre adresse mail.')
    if (await post({ etape: 'code' })) { setEtape('code'); setCode(['', '', '', '', '', '']); setTimeout(() => refs.current[0]?.focus(), 80) }
  }
  const verifier = async (c = code.join('')) => { if (c.length === 6 && await post({ etape: 'verifier', code: c })) location.href = '/espace' }
  const avecMdp = async () => { if (await post({ etape: 'mot-de-passe', motDePasse: mdp })) location.href = '/espace' }

  const saisir = (i: number, v: string) => {
    const chiffres = v.replace(/\D/g, '')
    if (chiffres.length > 1) { const n = chiffres.slice(0, 6).split(''); const c = [...n, '', '', '', '', '', ''].slice(0, 6); setCode(c); refs.current[Math.min(5, n.length)]?.focus(); if (n.length === 6) verifier(n.join('')); return }
    const c = [...code]; c[i] = chiffres; setCode(c)
    if (chiffres && i < 5) refs.current[i + 1]?.focus()
    if (c.join('').length === 6) verifier(c.join(''))
  }

  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[1.1fr_1fr]">
      <section className="esp-hero relative hidden flex-col justify-between overflow-hidden p-12 lg:flex">
        <div className="esp-rise relative z-10">
          <div className="text-xs font-semibold uppercase tracking-[.22em] text-rose-200">Verviers Dépannage · Espace client</div>
          <h1 className="font-display mt-6 max-w-lg text-5xl font-extrabold leading-[1.05] tracking-tight">Un dépannage commandé en 30 secondes. Suivi jusqu’au bout.</h1>
          <p className="mt-5 max-w-md text-lg text-slate-300">Demandes, suivi en direct, rapports d’intervention et factures : tout est ici, 24 h/24.</p>
        </div>
        <div className="relative z-10 space-y-3">
          {[['Remorquage en cours', 'VW Golf · 1ABC234', 'bg-rose-500'], ['En route', 'Peugeot 208 · 2DEF567', 'bg-indigo-500'], ['Terminée · rapport disponible', 'Renault Clio · 1GHI890', 'bg-emerald-500']].map(([a, b, c], k) => (
            <div key={a} className="esp-glass esp-rise flex max-w-sm items-center gap-3 rounded-2xl px-4 py-3" style={{ animationDelay: `${300 + k * 160}ms`, marginLeft: `${k * 28}px` }}>
              <span className={`esp-live ${c.replace('bg-', 'text-')}`} />
              <div><div className="text-sm font-bold">{a}</div><div className="text-xs text-slate-300">{b}</div></div>
            </div>
          ))}
        </div>
        <div className="h-24" />
        <div className="esp-road" />
        <div className="esp-drive pointer-events-none absolute bottom-[14px] left-0 w-[300px]"><Depanneuse /></div>
      </section>

      <section className="flex flex-col">
        <div className="esp-hero relative h-40 lg:hidden">
          <div className="relative z-10 px-6 pt-8"><div className="text-xs font-semibold uppercase tracking-[.22em] text-rose-200">Espace client</div><div className="font-display mt-1 text-2xl font-extrabold">Verviers Dépannage</div></div>
          <div className="esp-road" />
          <div className="esp-drive pointer-events-none absolute bottom-[14px] left-0 w-[190px]"><Depanneuse /></div>
        </div>
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="esp-card esp-pop w-full max-w-md p-7 md:p-9">
            <h2 className="font-display text-2xl font-extrabold tracking-tight">{etape === 'code' ? 'Vérifiez vos mails' : 'Connexion'}</h2>
            <p className="mt-1 text-sm text-slate-600">
              {etape === 'code' ? <>Nous avons envoyé un code à 6 chiffres à <b>{email}</b>. Il est valable 15 minutes.</> : 'Votre adresse professionnelle suffit : nous vous envoyons un code.'}
            </p>

            {etape !== 'code' && (
              <div className="mt-6 space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Adresse mail</span>
                  <input className="esp-input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && (etape === 'mdp' ? avecMdp() : demanderCode())} placeholder="vous@societe.be" />
                </label>
                {etape === 'mdp' && (
                  <label className="esp-rise block">
                    <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Mot de passe</span>
                    <input className="esp-input" type="password" autoComplete="current-password" value={mdp} onChange={e => setMdp(e.target.value)} onKeyDown={e => e.key === 'Enter' && avecMdp()} autoFocus />
                  </label>
                )}
                {err && <p className="text-sm font-semibold text-rose-700">{err}</p>}
                {etape === 'email'
                  ? <button onClick={demanderCode} disabled={busy} className="esp-btn esp-btn-red w-full disabled:opacity-60">{busy ? 'Envoi du code…' : 'Recevoir mon code'}</button>
                  : <button onClick={avecMdp} disabled={busy} className="esp-btn esp-btn-red w-full disabled:opacity-60">{busy ? 'Connexion…' : 'Se connecter'}</button>}
                <button onClick={() => { setErr(''); setEtape(etape === 'email' ? 'mdp' : 'email') }} className="min-h-[44px] w-full text-sm font-semibold text-slate-600 hover:text-slate-900">
                  {etape === 'email' ? 'J’ai un mot de passe' : 'Recevoir plutôt un code par mail'}
                </button>
              </div>
            )}

            {etape === 'code' && (
              <div className="mt-6">
                <div className="flex justify-between gap-2">
                  {code.map((c, i) => (
                    <input key={i} ref={el => { refs.current[i] = el }} value={c} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} maxLength={6}
                      onChange={e => saisir(i, e.target.value)} onKeyDown={e => { if (e.key === 'Backspace' && !c && i > 0) refs.current[i - 1]?.focus() }}
                      className="esp-input h-14 w-full !px-0 text-center font-display text-2xl font-extrabold" />
                  ))}
                </div>
                {err && <p className="mt-3 text-sm font-semibold text-rose-700">{err}</p>}
                <button onClick={() => verifier()} disabled={busy || code.join('').length < 6} className="esp-btn esp-btn-red mt-5 w-full disabled:opacity-60">{busy ? 'Vérification…' : 'Valider'}</button>
                <div className="mt-3 flex justify-between text-sm font-semibold">
                  <button onClick={() => { setEtape('email'); setErr('') }} className="min-h-[44px] text-slate-600 hover:text-slate-900">← Changer d’adresse</button>
                  <button onClick={demanderCode} disabled={busy} className="min-h-[44px] text-rose-700 hover:text-rose-900">Renvoyer un code</button>
                </div>
              </div>
            )}
            <p className="mt-6 border-t border-[#f3eee8] pt-4 text-center text-xs text-slate-500">Une urgence ? Appelez-nous 24 h/24.</p>
          </div>
        </div>
      </section>
    </div>
  )
}
