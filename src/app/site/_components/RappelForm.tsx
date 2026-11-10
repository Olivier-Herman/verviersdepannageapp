'use client'

// « Rappelez-moi » (lot 1, Olivier 10/11/2026) : un GSM, et le bureau rappelle
// sous le délai promis en heures ouvrables. De nuit, le formulaire reste là
// mais dit clairement qu'en cas d'urgence il faut appeler.

import { useState } from 'react'
import { useEtatSite, Moment } from './EtatSite'
import { TEL } from '../_data'

export default function RappelForm({ onDark = false }: { onDark?: boolean }) {
  const { delaiRappel } = useEtatSite()
  const [phone, setPhone] = useState('')
  const [website, setWebsite] = useState('')
  const [etat, setEtat] = useState<'idle' | 'envoi' | 'ok' | 'err'>('idle')
  const [msg, setMsg] = useState('')

  async function envoyer(e: React.FormEvent) {
    e.preventDefault()
    if (phone.replace(/\D/g, '').length < 9) { setEtat('err'); setMsg('Indiquez un numéro de GSM complet.'); return }
    setEtat('envoi')
    try {
      const r = await fetch('/api/site/rappel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, website, lang: 'fr' }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `La demande n’est pas passée. Appelez le ${TEL}.`)
      setEtat('ok')
      setMsg(j.heures ? `C’est noté. Nous vous rappelons dans les ${j.heures} heures ouvrables.` : 'C’est noté. Nous vous rappelons pendant les heures de bureau.')
    } catch (err: any) { setEtat('err'); setMsg(err.message) }
  }

  if (etat === 'ok') return <p className={`rappel-ok${onDark ? ' on-dark' : ''}`} role="status">{msg}</p>

  return (
    <form className={`rappel${onDark ? ' on-dark' : ''}`} onSubmit={envoyer} noValidate>
      <label htmlFor="rappel-gsm">
        Vous préférez être rappelé&nbsp;? Laissez votre GSM{delaiRappel ? <>, nous rappelons dans les {delaiRappel}&nbsp;heures ouvrables</> : null}.
      </label>
      <div className="rappel-row">
        <input id="rappel-gsm" type="tel" inputMode="tel" autoComplete="tel" placeholder="04.. .. .. .."
          value={phone} onChange={e => { setPhone(e.target.value); if (etat === 'err') setEtat('idle') }} />
        <button type="submit" className="submit" disabled={etat === 'envoi'}>{etat === 'envoi' ? 'Envoi…' : 'Rappelez-moi'}</button>
      </div>
      <input type="text" name="website" value={website} onChange={e => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="piege" />
      <Moment quand="nuit"><p className="rappel-note">Le bureau est fermé : nous rappelons à la réouverture. En panne maintenant&nbsp;? Appelez le {TEL}, le dépanneur de garde décroche.</p></Moment>
      {etat === 'err' && <p className="rappel-err" role="alert">{msg}</p>}
    </form>
  )
}
