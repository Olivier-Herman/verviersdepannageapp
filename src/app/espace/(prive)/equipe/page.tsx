'use client'
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useState } from 'react'
import { useEspace } from '../EspaceShell'
import { IMG } from '../../_ui/suivi'

interface Membre { id: string; nom: string; email: string; societe: string; peutInviter: boolean; actif: boolean; derniereConnexion: string | null }

export default function Equipe() {
  const { compte, societes } = useEspace()
  const gestionnaire = compte.role === 'gestionnaire'
  const [membres, setMembres] = useState<Membre[] | null>(null)
  const [ajout, setAjout] = useState(false)
  const [confirme, setConfirme] = useState<Membre | null>(null)
  const [toast, setToast] = useState('')
  const charger = useCallback(async () => {
    const r = await fetch('/api/espace/equipe', { cache: 'no-store' })
    if (r.status === 401) { location.href = '/espace/connexion'; return }
    setMembres((await r.json()).membres || [])
  }, [])
  useEffect(() => { charger() }, [charger])
  const montrer = (t: string) => { setToast(t); setTimeout(() => setToast(''), 2600) }
  const patch = async (id: string, body: any) => { await fetch('/api/espace/equipe', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) }); charger() }

  if (!compte.peutInviter) return <div className="wrap" style={{ paddingTop: 30, color: 'var(--ink2)' }}>Cette page est réservée aux personnes qui gèrent les accès.</div>

  return (
    <div className="wrap" style={{ maxWidth: 860, paddingBlock: 26 }}>
      <div className="card rise teamhead">
        <div style={{ padding: 22 }}>
          <h1 style={{ fontSize: 30 }}>Mon équipe</h1>
          <p style={{ color: 'var(--ink2)' }}>Donnez un accès à vos collaborateurs. Chacun commande pour sa société et ne voit que ses propres demandes.</p>
          <button className="btn btn-red" onClick={() => setAjout(true)}>+ Ajouter un collaborateur</button>
        </div>
        <img src={IMG.equipe} alt="" />
      </div>
      <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
        {membres === null && <div className="card" style={{ height: 76 }} />}
        {membres?.length === 0 && <div className="card" style={{ padding: 22, textAlign: 'center', color: 'var(--ink2)' }}>Pas encore de collaborateur. Ajoutez la première personne : elle reçoit un mail avec son accès.</div>}
        {membres?.map((x, i) => (
          <div key={x.id} className="card mem rise" style={{ animationDelay: `${i * 60}ms`, ...(x.actif ? {} : { opacity: .55 }) }}>
            <span className="avatar">{x.nom.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}</span>
            <div className="grow"><b>{x.nom}</b>{!x.actif && <small> · accès coupé</small>}<br /><small>{x.email} · {x.societe} · {x.derniereConnexion ? `vu le ${new Date(x.derniereConnexion).toLocaleDateString('fr-BE')}` : 'pas encore connecté'}</small></div>
            {gestionnaire && x.actif && <button className={`toggle ${x.peutInviter ? 'on' : ''}`} onClick={() => patch(x.id, { peutInviter: !x.peutInviter })}>{x.peutInviter ? '✓ Peut ajouter des collègues' : 'Ne peut pas ajouter'}</button>}
            {x.actif ? <button className="toggle" onClick={() => setConfirme(x)}>Couper l’accès</button> : <button className="toggle" onClick={async () => { await patch(x.id, { actif: true }); montrer('Accès rétabli') }}>Rétablir</button>}
          </div>
        ))}
      </div>

      {ajout && <Ajout societes={societes} gestionnaire={gestionnaire} onClose={() => setAjout(false)} onDone={(t) => { setAjout(false); montrer(t); charger() }} />}
      {confirme && (
        <div className="modal"><div className="card">
          <h2 style={{ fontSize: 20 }}>Couper l’accès de {confirme.nom} ?</h2>
          <p style={{ color: 'var(--ink2)' }}>Cette personne est déconnectée tout de suite. Ses demandes passées restent dans l’historique.</p>
          <div className="foot"><button className="btn btn-ghost" onClick={() => setConfirme(null)}>Annuler</button><button className="btn btn-red" onClick={async () => { await patch(confirme.id, { actif: false }); setConfirme(null); montrer('Accès coupé') }}>Couper</button></div>
        </div></div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function Ajout({ societes, gestionnaire, onClose, onDone }: { societes: { id: string; nom: string }[]; gestionnaire: boolean; onClose: () => void; onDone: (t: string) => void }) {
  const [nom, setNom] = useState(''), [email, setEmail] = useState(''), [socId, setSocId] = useState(societes.length === 1 ? societes[0].id : '')
  const [inviter, setInviter] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const go = async () => {
    setErr('')
    if (!nom.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || !socId) return setErr('Nom, adresse mail valide et société obligatoires.')
    setBusy(true)
    const r = await fetch('/api/espace/equipe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nom, email, societeId: socId, peutInviter: inviter }) })
    const j = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) return setErr(j.error || 'Erreur')
    onDone(j.invite !== false ? `${nom} a reçu son invitation` : `Accès créé ; le mail n’est pas parti, ${nom} peut se connecter avec son adresse`)
  }
  return (
    <div className="modal"><div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}><h2 style={{ fontSize: 20 }}>Ajouter un collaborateur</h2><button className="x" style={{ background: 'var(--soft)', color: 'var(--ink)' }} onClick={onClose} aria-label="Fermer">✕</button></div>
      <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
        <input className="input" placeholder="Prénom et nom" value={nom} onChange={e => setNom(e.target.value)} />
        <input className="input" type="email" placeholder="Adresse mail" value={email} onChange={e => setEmail(e.target.value)} />
        {societes.length > 1 && <div className="socs">{societes.map(s => <button key={s.id} className={`soc ${socId === s.id ? 'on' : ''}`} onClick={() => setSocId(s.id)}>{s.nom}</button>)}</div>}
        {gestionnaire && <label className="check"><input type="checkbox" checked={inviter} onChange={e => setInviter(e.target.checked)} /> Peut ajouter d’autres collaborateurs de sa société</label>}
        {err && <p className="err">{err}</p>}
        <button className="btn btn-red" disabled={busy} onClick={go}>{busy ? 'Création…' : 'Créer l’accès et envoyer l’invitation'}</button>
      </div>
    </div></div>
  )
}
