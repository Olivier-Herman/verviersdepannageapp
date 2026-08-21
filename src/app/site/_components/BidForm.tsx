'use client'

// Dépôt d'une offre. La validation sérieuse est côté API (montant minimum,
// lot encore ouvert, clôture dépassée) : ici on évite juste au visiteur un
// aller-retour évident. Après envoi, on ne remet pas le formulaire : l'offre
// doit être confirmée par e-mail, pas redéposée trois fois.

import { useState } from 'react'
import { TEL }      from '../_data'
import type { SaleMode } from '@/lib/ventes/types'

export default function BidForm({
  reference, mode, minimum,
}: { reference: string; mode: SaleMode; minimum: number }) {
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState<string | null>(null)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/ventes/${encodeURIComponent(reference)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount:  Number(f.get('amount')),
          name:    f.get('name'),
          email:   f.get('email'),
          phone:   f.get('phone'),
          is_pro:  f.get('type') === 'Professionnel',
          intent:  f.get('intent'),
          message: f.get('message'),
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
        <b>Offre enregistrée</b>
        <p>
          Un e-mail vient de partir à l’adresse indiquée&nbsp;: cliquez sur le lien pour confirmer,
          sinon l’offre ne sera pas prise en compte.
        </p>
        <p>Vous serez prévenu à la clôture, que votre offre soit retenue ou non.</p>
      </div>
    )
  }

  return (
    <form className="stack g16" onSubmit={submit}>
      <div className="f f-amount">
        <label htmlFor="amount">Votre offre, en euros TVAC</label>
        <input id="amount" name="amount" type="number" min={mode === 'sealed' ? 1 : minimum}
          step={1} inputMode="numeric" required
          placeholder={mode === 'sealed' ? '1 250' : String(minimum)} />
        {mode !== 'sealed' && (
          <span style={{ fontSize: '.78rem', color: 'var(--panel-muted)' }}>
            Minimum&nbsp;: {minimum.toLocaleString('fr-BE')} €
          </span>
        )}
      </div>
      <div className="frow">
        <div className="f"><label htmlFor="name">Nom et prénom</label>
          <input id="name" name="name" type="text" required autoComplete="name" /></div>
        <div className="f"><label htmlFor="phone">Téléphone</label>
          <input id="phone" name="phone" type="tel" required autoComplete="tel" /></div>
      </div>
      <div className="f"><label htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" required autoComplete="email" /></div>
      <div className="frow">
        <div className="f"><label htmlFor="type">Vous êtes</label>
          <select id="type" name="type"><option>Particulier</option><option>Professionnel</option></select></div>
        <div className="f"><label htmlFor="intent">Destination du véhicule</label>
          <select id="intent" name="intent">
            <option value="circulation">Remise en circulation</option>
            <option value="pieces">Pièces détachées</option>
            <option value="indecis">Pas encore décidé</option>
          </select></div>
      </div>
      <div className="f"><label htmlFor="message">Message (facultatif)</label>
        <textarea id="message" name="message" rows={2}
          placeholder="Une question, une contrainte d’enlèvement…" /></div>
      <label className="check">
        <input type="checkbox" required /> J’ai lu les conditions de vente et je comprends que le
        véhicule est vendu en l’état, sans garantie.
      </label>
      {err && <p className="bid-err">⚠ {err} — en cas de doute, appelez le {TEL}.</p>}
      <button type="submit" className="submit" disabled={busy}>
        {busy ? 'Envoi…' : 'Déposer mon offre'}
      </button>
    </form>
  )
}
