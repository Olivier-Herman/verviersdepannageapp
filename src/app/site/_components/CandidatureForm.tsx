'use client'

// Candidature chauffeur-dépanneur (lot 1, Olivier 10/11/2026) : deux minutes
// depuis un téléphone. Permis, expérience, nom, GSM ; e-mail, message et CV
// facultatifs.

import { useEffect, useState } from 'react'
import { TEL } from '../_data'

const PERMIS = ['B', 'BE', 'C', 'CE', 'ADR']

export default function CandidatureForm() {
  const [permis, setPermis] = useState<string[]>([])
  const [exp, setExp] = useState<'' | 'oui' | 'non'>('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [cv, setCv] = useState<File | null>(null)
  const [website, setWebsite] = useState('')
  const [etat, setEtat] = useState<'idle' | 'envoi' | 'ok' | 'err'>('idle')
  const [msg, setMsg] = useState('')

  const bascule = (p: string) => setPermis(l => l.includes(p) ? l.filter(x => x !== p) : [...l, p])

  // Le message d'erreur disparaît dès que la personne corrige quelque chose.
  useEffect(() => { setEtat(e => e === 'err' ? 'idle' : e) }, [permis, exp, name, phone, cv])

  async function envoyer(e: React.FormEvent) {
    e.preventDefault()
    const manque = !permis.length ? 'Cochez au moins un permis.'
      : !exp ? 'Dites-nous si vous avez déjà fait du dépannage.'
      : !name.trim() ? 'Votre nom est requis.'
      : phone.replace(/\D/g, '').length < 9 ? 'Indiquez un numéro de GSM complet.'
      : cv && cv.size > 8 * 1024 * 1024 ? 'Le CV dépasse 8 Mo.' : ''
    if (manque) { setEtat('err'); setMsg(manque); return }
    setEtat('envoi')
    const fd = new FormData()
    fd.set('permis', permis.join(',')); fd.set('experience', exp); fd.set('name', name); fd.set('phone', phone)
    fd.set('email', email); fd.set('message', message); fd.set('website', website); fd.set('lang', 'fr')
    if (cv) fd.set('cv', cv)
    try {
      const r = await fetch('/api/site/candidature', { method: 'POST', body: fd })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `La candidature n’est pas passée. Appelez le ${TEL}.`)
      setEtat('ok')
    } catch (err: any) { setEtat('err'); setMsg(err.message) }
  }

  if (etat === 'ok') {
    return (
      <div className="bid-ok" role="status">
        <b>Merci {name.split(' ')[0]}, c’est bien reçu.</b>
        <p>Nous vous rappelons au {phone} pour faire connaissance.</p>
      </div>
    )
  }

  return (
    <form className="stack g16" onSubmit={envoyer} noValidate>
      <fieldset className="f">
        <legend>Vos permis</legend>
        <div className="chips">
          {PERMIS.map(p => (
            <button key={p} type="button" className="chip" aria-pressed={permis.includes(p)} onClick={() => bascule(p)}>{p}</button>
          ))}
        </div>
      </fieldset>
      <fieldset className="f">
        <legend>Déjà fait du dépannage&nbsp;?</legend>
        <div className="chips">
          <button type="button" className="chip" aria-pressed={exp === 'oui'} onClick={() => setExp('oui')}>Oui</button>
          <button type="button" className="chip" aria-pressed={exp === 'non'} onClick={() => setExp('non')}>Non, mais motivé</button>
        </div>
      </fieldset>
      <div className="frow">
        <div className="f"><label htmlFor="c-nom">Nom et prénom</label><input id="c-nom" autoComplete="name" value={name} onChange={e => setName(e.target.value)} /></div>
        <div className="f"><label htmlFor="c-gsm">GSM</label><input id="c-gsm" type="tel" inputMode="tel" autoComplete="tel" placeholder="04.. .. .. .." value={phone} onChange={e => setPhone(e.target.value)} /></div>
      </div>
      <div className="f"><label htmlFor="c-mail">E-mail <span className="opt">(facultatif)</span></label><input id="c-mail" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
      <div className="f"><label htmlFor="c-msg">Un mot sur vous <span className="opt">(facultatif)</span></label><textarea id="c-msg" rows={3} value={message} onChange={e => setMessage(e.target.value)} /></div>
      <div className="f">
        <label htmlFor="c-cv">CV <span className="opt">(facultatif : PDF, photo ou Word, 8 Mo maximum)</span></label>
        <input id="c-cv" type="file" accept="application/pdf,image/*,.doc,.docx" onChange={e => setCv(e.target.files?.[0] || null)} />
      </div>
      <input type="text" name="website" value={website} onChange={e => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="piege" />
      {etat === 'err' && <p className="bid-err" role="alert">{msg}</p>}
      <div><button type="submit" className="submit" disabled={etat === 'envoi'}>{etat === 'envoi' ? 'Envoi…' : 'Envoyer ma candidature'}</button></div>
    </form>
  )
}
