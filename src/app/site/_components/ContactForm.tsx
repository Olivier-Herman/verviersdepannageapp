'use client'

// Formulaire de contact du site. Le motif peut arriver par l'URL
// (?motif=evenement depuis la page circuit, ?motif=pro depuis la page pros)
// pour que le visiteur n'ait pas à le rechoisir. Le champ « website » est un
// piège à robots : caché, jamais rempli par un humain. Olivier 2026-09-15.

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { TEL, TEL_HREF } from '../_data'

const MOTIFS = [
  { key: 'depannage', label: 'Une question ou une demande de dépannage non urgente' },
  { key: 'pro',       label: 'Je suis un professionnel — garage, assureur, loueur' },
  { key: 'evenement', label: 'J’organise un événement, un roulage, un chantier' },
]

export default function ContactForm() {
  const params = useSearchParams()
  const initial = MOTIFS.some(m => m.key === params.get('motif')) ? params.get('motif')! : 'depannage'
  const [motif, setMotif] = useState(initial)
  const [done, setDone]   = useState(false)
  const [busy, setBusy]   = useState(false)
  const [err,  setErr]    = useState<string | null>(null)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/site/contact', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          motif, name: f.get('name'), email: f.get('email'), phone: f.get('phone'),
          company: f.get('company'), message: f.get('message'), website: f.get('website'),
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error || 'Envoi impossible.')
      setDone(true)
    } catch (e: any) { setErr(e?.message || 'Erreur') } finally { setBusy(false) }
  }

  if (done) {
    return (
      <div className="bid-ok">
        <b>Bien reçu</b>
        <p>Votre message est arrivé chez nous. Nous répondons pendant les heures de bureau, en général le jour même.</p>
        <p>Si vous êtes en panne maintenant, n’attendez pas&nbsp;: appelez le <strong style={{ color: '#fff' }}>{TEL}</strong>.</p>
      </div>
    )
  }

  return (
    <form className="stack g16" onSubmit={submit}>
      <div className="f">
        <label htmlFor="c-motif">Vous nous écrivez pour</label>
        <select id="c-motif" value={motif} onChange={e => setMotif(e.target.value)}>
          {MOTIFS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </div>
      <div className="frow">
        <div className="f"><label htmlFor="c-name">Nom et prénom</label>
          <input id="c-name" name="name" type="text" required autoComplete="name" /></div>
        <div className="f"><label htmlFor="c-company">{motif === 'depannage' ? 'Société (facultatif)' : 'Société'}</label>
          <input id="c-company" name="company" type="text" autoComplete="organization" required={motif !== 'depannage'} /></div>
      </div>
      <div className="frow">
        <div className="f"><label htmlFor="c-email">E-mail</label>
          <input id="c-email" name="email" type="email" required autoComplete="email" /></div>
        <div className="f"><label htmlFor="c-phone">Téléphone (facultatif)</label>
          <input id="c-phone" name="phone" type="tel" autoComplete="tel" /></div>
      </div>
      <div className="f">
        <label htmlFor="c-msg">Votre message</label>
        <textarea id="c-msg" name="message" rows={5} required minLength={10}
          placeholder={
            motif === 'evenement' ? 'Date, lieu, affluence attendue, durée, ce dont vous avez besoin…'
            : motif === 'pro' ? 'Type de véhicule, trajet, fréquence, contraintes d’horaire…'
            : 'Dites-nous ce qu’il vous faut.'
          } />
      </div>
      {/* piège à robots — hors écran, hors tabulation */}
      <div style={{ position: 'absolute', left: -9999, width: 1, height: 1, overflow: 'hidden' }} aria-hidden="true">
        <label>Site web<input name="website" type="text" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <p style={{ fontSize: '.85rem', color: 'var(--panel-muted)' }}>
        Ce formulaire n’est pas fait pour une urgence. Si vous êtes en panne maintenant,
        appelez le <a href={TEL_HREF} style={{ color: '#fff', fontWeight: 600 }}>{TEL}</a>.
      </p>
      {err && <p className="bid-err">⚠ {err}</p>}
      <button type="submit" className="submit" disabled={busy}>{busy ? 'Envoi…' : 'Envoyer'}</button>
    </form>
  )
}
