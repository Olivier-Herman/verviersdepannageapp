'use client'
import { useEffect, useRef, useState } from 'react'
import { IMG, Marque } from '../_ui/suivi'

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
    const ch = v.replace(/\D/g, '')
    if (ch.length > 1) { const n = ch.slice(0, 6).split(''); setCode([...n, '', '', '', '', '', ''].slice(0, 6)); refs.current[Math.min(5, n.length)]?.focus(); if (n.length === 6) verifier(n.join('')); return }
    const c = [...code]; c[i] = ch; setCode(c)
    if (ch && i < 5) refs.current[i + 1]?.focus()
    if (c.join('').length === 6) verifier(c.join(''))
  }

  return (
    <div className="login">
      <section className="login-art">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={IMG.nuit} alt="" />
        <div className="login-copy rise"><h1>Un dépannage commandé en 30 secondes. Suivi jusqu’au bout.</h1><p>Demandes, suivi en direct, rapports d’intervention et factures : tout est ici, 24 h/24.</p></div>
      </section>
      <section className="login-side">
        <div className="login-card rise">
          <Marque />
          <h2 style={{ fontSize: 28, marginTop: 28 }}>{etape === 'code' ? 'Vérifiez vos mails' : 'Connexion'}</h2>
          <p style={{ color: 'var(--ink2)', margin: '6px 0 22px' }}>
            {etape === 'code' ? <>Code à 6 chiffres envoyé à <b>{email}</b>. Valable 15 minutes.</> : 'Votre adresse professionnelle suffit : nous vous envoyons un code.'}
          </p>
          {etape === 'code' ? (
            <>
              <div className="otp">
                {code.map((c, i) => (
                  <input key={i} ref={el => { refs.current[i] = el }} value={c} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} maxLength={6} aria-label={`Chiffre ${i + 1}`}
                    onChange={e => saisir(i, e.target.value)} onKeyDown={e => { if (e.key === 'Backspace' && !c && i > 0) refs.current[i - 1]?.focus() }} />
                ))}
              </div>
              {err && <p className="err">{err}</p>}
              <button className="btn btn-red" style={{ width: '100%', marginTop: 18 }} disabled={busy || code.join('').length < 6} onClick={() => verifier()}>{busy ? 'Vérification…' : 'Valider'}</button>
              <div className="foot"><button className="link" onClick={() => { setEtape('email'); setErr('') }}>← Changer d’adresse</button><button className="link" disabled={busy} onClick={demanderCode}>Renvoyer un code</button></div>
            </>
          ) : (
            <>
              <label className="field"><span>Adresse mail</span><input className="input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && (etape === 'mdp' ? avecMdp() : demanderCode())} placeholder="vous@societe.be" /></label>
              {etape === 'mdp' && <label className="field rise" style={{ marginTop: 12 }}><span>Mot de passe</span><input className="input" type="password" autoComplete="current-password" value={mdp} onChange={e => setMdp(e.target.value)} onKeyDown={e => e.key === 'Enter' && avecMdp()} autoFocus /></label>}
              {err && <p className="err">{err}</p>}
              <button className="btn btn-red" style={{ width: '100%', marginTop: 14 }} disabled={busy} onClick={etape === 'mdp' ? avecMdp : demanderCode}>{busy ? 'Un instant…' : etape === 'mdp' ? 'Se connecter' : 'Recevoir mon code'}</button>
              <button style={{ width: '100%', minHeight: 46, marginTop: 6, fontWeight: 700, color: 'var(--ink2)' }} onClick={() => { setErr(''); setEtape(etape === 'email' ? 'mdp' : 'email') }}>{etape === 'mdp' ? 'Recevoir plutôt un code par mail' : 'J’ai un mot de passe'}</button>
            </>
          )}
          <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--mute)', borderTop: '1px solid var(--line)', paddingTop: 14, marginTop: 22 }}>Une urgence ? Appelez-nous 24 h/24.</p>
        </div>
      </section>
    </div>
  )
}
