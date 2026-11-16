'use client'
/* eslint-disable @next/next/no-img-element */
// Commande d'un transport TGR (Olivier 16/11/2026, maquette validée le même jour) : pour une société dont le
// formulaire est « transport ». Deux étapes : le véhicule et le trajet, puis le délai et le contact.
// Les adresses enregistrées de la société sont proposées comme lieu de prise en charge (son dépôt).
import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { SocieteEspace } from '../EspaceShell'
import { IMG, IcoPin, PastillePriorite, Plaque } from '../../_ui/suivi'
import AdresseInline, { type AdresseChoisie } from '../../_ui/AdresseInline'
import { PRIORITES_TRANSPORT, echeanceTransport, type PrioriteTransport } from '@/lib/espace/transport'

const vide: AdresseChoisie = { texte: '', lat: null, lng: null }

export default function CommanderTransport({ societe, onChanger }: { societe: SocieteEspace; onChanger?: () => void }) {
  const depot = societe.garages[0]
  const [pas, setPas] = useState(0)
  const [plaque, setPlaque] = useState(''), [marque, setMarque] = useState(''), [modele, setModele] = useState('')
  const [roulant, setRoulant] = useState<boolean | null>(null)
  const [prise, setPrise] = useState<AdresseChoisie>(depot ? { texte: depot.adresse, lat: depot.lat, lng: depot.lng, nom: depot.nom } : vide)
  const [priseAutre, setPriseAutre] = useState(!depot)
  const [dest, setDest] = useState<AdresseChoisie>(vide)
  const [priorite, setPriorite] = useState<PrioriteTransport>(2)
  const [reference, setReference] = useState('')
  const [contactNom, setContactNom] = useState(''), [contactTel, setContactTel] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const [fait, setFait] = useState<number | null>(null)
  const echeances = useMemo(() => ({ 1: echeanceTransport(1).libelle, 2: echeanceTransport(2).libelle, 3: echeanceTransport(3).libelle }), [])

  const manque = (pas === 0
    ? [!plaque.trim() && 'la plaque', roulant === null && 'si le véhicule roule', !prise.texte.trim() && 'l’adresse de prise en charge', !dest.texte.trim() && 'l’adresse de livraison']
    : [!contactNom.trim() && 'la personne à prévenir', !contactTel.trim() && 'son numéro']).filter(Boolean) as string[]

  const envoyer = async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/espace/missions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          societeId: societe.id, plaque, marque, modele, roulant, priorite,
          adresse: prise.texte, lat: prise.lat, lng: prise.lng,
          destination: dest.texte, destinationNom: dest.nom || null, destLat: dest.lat, destLng: dest.lng,
          contactNom, contactTel, messageChauffeur: message.trim() || null, reference: reference.trim() || null,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (r.status === 401) { location.href = '/espace/connexion'; return }
      if (!r.ok) throw new Error(j.error || 'Envoi impossible')
      setFait(j.numero); window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  if (fait) return (
    <div className="wrap">
      <div className="card ok-wrap rise">
        <img src={IMG.succes} alt="" />
        <div style={{ padding: 26 }}>
          <h2 style={{ fontSize: 28 }}>Demande envoyée</h2>
          <p style={{ color: 'var(--ink2)' }}>Notre équipe est prévenue à l’instant. Vous suivez le transport n° <b>{fait}</b> en direct.</p>
          <div className="foot" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/espace" className="btn btn-red">Suivre le transport</Link>
            <button className="btn btn-ghost" onClick={() => location.reload()}>Nouvelle demande</button>
          </div>
        </div>
      </div>
    </div>
  )

  const titres = ['Le véhicule et le trajet', 'Le délai et le contact']
  return (
    <div className="wrap" style={{ maxWidth: 760, paddingBlock: '26px 30px' }}>
      <div className="rise">
        <h1 style={{ fontSize: 32 }}>Commander un transport</h1>
        <p style={{ color: 'var(--ink2)', margin: '4px 0 0' }}>{titres[pas]} — étape {pas + 1} sur 2{onChanger && <> · {societe.nom} <button className="link" style={{ minHeight: 44 }} onClick={onChanger}>changer de société</button></>}</p>
      </div>
      <div className="steps">{[0, 1].map(i => <div key={i}><span style={{ width: `${i < pas ? 100 : i === pas ? 50 : 0}%` }} /></div>)}</div>
      <div className="card rise" style={{ padding: 20 }}>
        {pas === 0 && <>
          <div className="cols">
            <label className="field"><span>Plaque *</span><div className="platein"><i>B</i><input value={plaque} onChange={e => setPlaque(e.target.value.toUpperCase().replace(/\s/g, ''))} placeholder="1ABC234" /></div></label>
            <div className="cols">
              <label className="field"><span>Marque</span><input className="input" value={marque} onChange={e => setMarque(e.target.value)} placeholder="Volkswagen" /></label>
              <label className="field"><span>Modèle</span><input className="input" value={modele} onChange={e => setModele(e.target.value)} placeholder="Golf" /></label>
            </div>
          </div>
          <div className="field" style={{ marginTop: 16 }}>
            <span>Le véhicule roule-t-il ? *</span>
            <div className="when2"><button className={roulant === true ? 'on' : ''} onClick={() => setRoulant(true)}>Il roule</button><button className={roulant === false ? 'on' : ''} onClick={() => setRoulant(false)}>Il ne roule pas</button></div>
          </div>
          <div className="field" style={{ marginTop: 16 }}>
            <span>Où prendre le véhicule ? *</span>
            {societe.garages.length > 0 && (
              <div className="socs">
                {societe.garages.map(g => {
                  const on = !priseAutre && prise.texte === g.adresse
                  return <button key={g.adresse} className={`soc ${on ? 'on' : ''}`} style={{ flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 0, minHeight: 64, padding: '8px 14px' }} onClick={() => { setPriseAutre(false); setPrise({ texte: g.adresse, lat: g.lat, lng: g.lng, nom: g.nom }) }}>
                    <span>{g.nom}{on && <span style={{ color: 'var(--red)' }}> ✓</span>}</span><small style={{ fontWeight: 500, color: 'var(--mute)' }}>{g.adresse}</small>
                  </button>
                })}
                <button className={`soc ${priseAutre ? 'on' : ''}`} style={{ minHeight: 64 }} onClick={() => { setPriseAutre(true); setPrise(vide) }}>Autre adresse…</button>
              </div>
            )}
            {priseAutre && <div style={{ marginTop: societe.garages.length ? 8 : 0 }}><AdresseInline valeur={prise} onChange={setPrise} placeholder="Garage, rue, numéro, localité" autoFocus={societe.garages.length > 0} /></div>}
          </div>
          <div className="field" style={{ marginTop: 16 }}><span>Où le livrer ? *</span><AdresseInline valeur={dest} onChange={setDest} placeholder="Garage, rue, numéro, localité" /></div>
        </>}

        {pas === 1 && <>
          <div className="field">
            <span>Pour quand ? *</span>
            <div className="prios">
              {PRIORITES_TRANSPORT.map(p => (
                <button key={p.v} className={`prio p${p.v} ${priorite === p.v ? 'on' : ''}`} onClick={() => setPriorite(p.v)}>
                  <span className="n">{p.v}</span><span><b>{p.titre}</b><small>{p.sous}</small></span><span className="d">{echeances[p.v]}</span>
                </button>
              ))}
            </div>
          </div>
          <label className="field" style={{ marginTop: 18 }}><span>Référence du dossier Touring <small style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>(facultatif)</small></span><input className="input" value={reference} onChange={e => setReference(e.target.value.toUpperCase())} placeholder="2026BE131221" /></label>
          <p style={{ margin: '6px 2px 0', fontSize: 13, color: 'var(--ink2)' }}>Sans référence, la plaque sert de référence sur la facture.</p>
          <h3 style={{ fontSize: 18, margin: '22px 0 12px' }}>À la livraison</h3>
          <div className="cols">
            <label className="field"><span>Personne à prévenir *</span><input className="input" value={contactNom} onChange={e => setContactNom(e.target.value)} placeholder="Nom de la personne présente" /></label>
            <label className="field"><span>Son numéro *</span><input className="input" type="tel" value={contactTel} onChange={e => setContactTel(e.target.value)} placeholder="+32 4.. .. .. .." /></label>
          </div>
          <label className="field" style={{ marginTop: 14 }}><span>Message pour le chauffeur</span><textarea className="input" value={message} onChange={e => setMessage(e.target.value)} placeholder="Ex. : clés à l’accueil, code du portail, demander Julie…" /></label>
          <p style={{ margin: '6px 2px 0', fontSize: 13, color: 'var(--ink2)' }}>Le chauffeur le voit en acceptant la mission et doit confirmer qu’il l’a lu. Vous voyez ensuite « lu et confirmé ».</p>
          <div className="card recap" style={{ padding: 14, marginTop: 16, boxShadow: 'none' }}>
            <img src={IMG.rem} alt="" />
            <div style={{ minWidth: 0 }}>
              <b className="disp" style={{ fontSize: 17 }}>Transport TGR · {societe.nom}</b>
              <div style={{ margin: '6px 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><Plaque v={plaque || '—'} /><span className="veh">{[marque, modele].filter(Boolean).join(' ')}</span><PastillePriorite p={priorite} /></div>
              <div className="addr" style={{ margin: 0 }}><IcoPin /><span>{prise.texte}</span></div>
              <div style={{ marginTop: 6, fontSize: 14, color: 'var(--ink2)' }}>Livraison : {dest.texte}</div>
              <div style={{ marginTop: 6, fontSize: 14, color: 'var(--ink2)' }}>{roulant ? 'Le véhicule roule' : 'Le véhicule ne roule pas'} · {echeances[priorite]}</div>
            </div>
          </div>
        </>}

        {err && <p className="err" style={{ marginTop: 12 }}>{err}</p>}
        <div className="foot">
          {pas > 0 ? <button className="btn btn-ghost" onClick={() => setPas(0)}>← Retour</button> : <span />}
          <span style={{ flex: 1, textAlign: 'right', fontSize: 13, color: 'var(--mute)' }}>{manque.length ? 'Encore : ' + manque.join(', ') : ''}</span>
          <button className="btn btn-red" disabled={!!manque.length || busy} onClick={() => pas < 1 ? (setPas(1), window.scrollTo({ top: 0, behavior: 'smooth' })) : envoyer()}>{pas < 1 ? 'Continuer →' : busy ? 'Envoi…' : 'Envoyer la demande'}</button>
        </div>
      </div>
    </div>
  )
}
