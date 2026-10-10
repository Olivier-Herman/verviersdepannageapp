'use client'
/* eslint-disable @next/next/no-img-element */
import Link from 'next/link'
import { useState } from 'react'
import { useEspace } from '../EspaceShell'
import { IMG, IcoPin, Plaque } from '../../_ui/suivi'
import AdresseInline, { type AdresseChoisie } from '../../_ui/AdresseInline'

const vide: AdresseChoisie = { texte: '', lat: null, lng: null }
const PANNES = ['Ne démarre pas', 'Batterie', 'Crevaison', 'Accident', 'Bruit / fumée', 'Clés perdues ou enfermées', 'Autre']

export default function Commander() {
  const { societes } = useEspace()
  const [pas, setPas] = useState(0)
  const [socId, setSocId] = useState(societes.length === 1 ? societes[0].id : '')
  const [type, setType] = useState<'DSP' | 'REM' | ''>('')
  const [plaque, setPlaque] = useState(''), [marque, setMarque] = useState(''), [modele, setModele] = useState('')
  const [adresse, setAdresse] = useState<AdresseChoisie>(vide)
  const [panne, setPanne] = useState(''), [panneTxt, setPanneTxt] = useState('')
  const [dest, setDest] = useState<AdresseChoisie>(vide), [destAutre, setDestAutre] = useState(false)
  const [planifier, setPlanifier] = useState(false), [quand, setQuand] = useState('')
  const [contactNom, setContactNom] = useState(''), [contactTel, setContactTel] = useState('')
  const [message, setMessage] = useState(''), [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const [fait, setFait] = useState<number | null>(null)
  const societe = societes.find(s => s.id === socId)
  const garage = !destAutre ? societe?.garages.find(g => g.adresse === dest.texte) : undefined

  const manque = (pas === 0 ? [!socId && 'la société', !type && 'le type']
    : pas === 1 ? [!plaque.trim() && 'la plaque', !adresse.texte.trim() && 'l’adresse', type === 'REM' && !dest.texte.trim() && 'l’adresse de livraison']
      : [planifier && !quand && 'la date', !contactNom.trim() && 'le contact sur place', !contactTel.trim() && 'son numéro']).filter(Boolean) as string[]

  const envoyer = async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/espace/missions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          societeId: socId, type, plaque, marque, modele, adresse: adresse.texte, lat: adresse.lat, lng: adresse.lng,
          destination: type === 'REM' ? dest.texte : null, destinationNom: garage?.nom || dest.nom || null, destLat: garage?.lat ?? dest.lat, destLng: garage?.lng ?? dest.lng,
          panne: [panne, panneTxt.trim()].filter(Boolean).join(' — ') || null,
          contactNom, contactTel, messageChauffeur: message.trim() || null, reference: reference.trim() || null,
          quand: planifier && quand ? new Date(quand).toISOString() : null,
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
          <p style={{ color: 'var(--ink2)' }}>Notre équipe est prévenue à l’instant. Vous suivez l’intervention n° <b>{fait}</b> en direct.</p>
          <div className="foot" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/espace" className="btn btn-red">Suivre l’intervention</Link>
            <button className="btn btn-ghost" onClick={() => location.reload()}>Nouvelle demande</button>
          </div>
        </div>
      </div>
    </div>
  )

  const titres = ['Votre besoin', 'Le véhicule et le lieu', 'Quand et qui contacter']
  return (
    <div className="wrap" style={{ maxWidth: 760, paddingBlock: '26px 30px' }}>
      <div className="rise"><h1 style={{ fontSize: 32 }}>Commander une intervention</h1><p style={{ color: 'var(--ink2)', margin: '4px 0 0' }}>{titres[pas]} — étape {pas + 1} sur 3</p></div>
      <div className="steps">{[0, 1, 2].map(i => <div key={i}><span style={{ width: `${i < pas ? 100 : i === pas ? 50 : 0}%` }} /></div>)}</div>
      <div className="card rise" style={{ padding: 20 }}>
        {pas === 0 && <>
          {societes.length > 1 && <>
            <h3 style={{ fontSize: 18, margin: '4px 0 12px' }}>Pour quelle société ?</h3>
            <div className="socs">{societes.map(s => <button key={s.id} className={`soc ${socId === s.id ? 'on' : ''}`} onClick={() => { if (s.id !== socId) { setDest(vide); setDestAutre(false) } setSocId(s.id) }}><span className="dot" style={{ background: s.couleur || '#d42a2a' }} />{s.nom}{socId === s.id && <span style={{ marginLeft: 'auto', color: 'var(--red)' }}>✓</span>}</button>)}</div>
            <div style={{ height: 22 }} />
          </>}
          <h3 style={{ fontSize: 18, margin: '4px 0 12px' }}>De quoi avez-vous besoin ?</h3>
          <div className="choice">
            {([['DSP', IMG.dsp, 'Dépannage sur place', 'Batterie, crevaison, démarrage… on répare sur place si c’est possible.'], ['REM', IMG.rem, 'Remorquage', 'Le véhicule ne roule plus : on le charge et on le livre où vous voulez.']] as const).map(([v, im, t, s]) => (
              <button key={v} className={`opt ${type === v ? 'on' : ''}`} onClick={() => setType(v)}><img src={im} alt="" /><span className="ok">✓</span><div><b>{t}</b><p>{s}</p></div></button>
            ))}
          </div>
        </>}

        {pas === 1 && <>
          <div className="cols">
            <label className="field"><span>Plaque *</span><div className="platein"><i>B</i><input value={plaque} onChange={e => setPlaque(e.target.value.toUpperCase().replace(/\s/g, ''))} placeholder="1ABC234" /></div></label>
            <div className="cols">
              <label className="field"><span>Marque</span><input className="input" value={marque} onChange={e => setMarque(e.target.value)} placeholder="Volkswagen" /></label>
              <label className="field"><span>Modèle</span><input className="input" value={modele} onChange={e => setModele(e.target.value)} placeholder="Golf" /></label>
            </div>
          </div>
          <div className="field" style={{ marginTop: 16 }}><span>Où se trouve le véhicule ? *</span><AdresseInline valeur={adresse} onChange={setAdresse} placeholder="Rue, numéro, localité" gps /></div>
          <div className="field" style={{ marginTop: 16 }}>
            <span>Première indication sur la panne</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{PANNES.map(x => <button key={x} className={`chip ${panne === x ? 'on' : ''}`} onClick={() => setPanne(panne === x ? '' : x)}>{x}</button>)}</div>
            <input className="input" style={{ marginTop: 8 }} value={panneTxt} onChange={e => setPanneTxt(e.target.value)} placeholder="Ce que vous savez déjà : voyant allumé, bruit, depuis quand…" />
          </div>
          {type === 'REM' && (
            <div className="field" style={{ marginTop: 16 }}>
              <span>Où livrer le véhicule ? *</span>
              <div className="socs">
                {(societe?.garages || []).map(g => {
                  const on = !destAutre && dest.texte === g.adresse
                  return <button key={g.adresse} className={`soc ${on ? 'on' : ''}`} style={{ flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 0, minHeight: 64, padding: '8px 14px' }} onClick={() => { setDestAutre(false); setDest({ texte: g.adresse, lat: g.lat, lng: g.lng, nom: g.nom }) }}>
                    <span>{g.nom}{on && <span style={{ color: 'var(--red)' }}> ✓</span>}</span><small style={{ fontWeight: 500, color: 'var(--mute)' }}>{g.adresse}</small>
                  </button>
                })}
                <button className={`soc ${destAutre ? 'on' : ''}`} style={{ minHeight: 64 }} onClick={() => { setDestAutre(true); setDest(vide) }}>Autre adresse…</button>
              </div>
              {destAutre && <div style={{ marginTop: 8 }}><AdresseInline valeur={dest} onChange={setDest} placeholder="Garage, rue, numéro, localité" autoFocus /></div>}
            </div>
          )}
        </>}

        {pas === 2 && <>
          <h3 style={{ fontSize: 18, margin: '4px 0 12px' }}>Quand ?</h3>
          <div className="when2"><button className={!planifier ? 'on' : ''} onClick={() => setPlanifier(false)}>Dès que possible</button><button className={planifier ? 'on' : ''} onClick={() => setPlanifier(true)}>À une date précise</button></div>
          {planifier && <input className="input rise" style={{ marginTop: 10 }} type="datetime-local" value={quand} onChange={e => setQuand(e.target.value)} min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} />}
          <h3 style={{ fontSize: 18, margin: '22px 0 12px' }}>Sur place</h3>
          <div className="cols">
            <label className="field"><span>Contact sur place *</span><input className="input" value={contactNom} onChange={e => setContactNom(e.target.value)} placeholder="Nom de la personne présente" /></label>
            <label className="field"><span>Numéro du contact sur place *</span><input className="input" type="tel" value={contactTel} onChange={e => setContactTel(e.target.value)} placeholder="+32 4.. .. .. .." /></label>
          </div>
          <label className="field" style={{ marginTop: 14 }}><span>Message pour le chauffeur</span><textarea className="input" value={message} onChange={e => setMessage(e.target.value)} placeholder="Ex. : clés à l’accueil, véhicule au niveau -2, demander Julie…" /></label>
          <p style={{ margin: '6px 2px 0', fontSize: 13, color: 'var(--ink2)' }}>Le chauffeur le voit en acceptant la mission et doit confirmer qu’il l’a lu. Vous voyez ensuite « lu et confirmé ».</p>
          <label className="field" style={{ marginTop: 14 }}><span>Votre référence <small style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>(facultatif)</small></span><input className="input" value={reference} onChange={e => setReference(e.target.value)} placeholder="N° de dossier, de commande…" /></label>
          <div className="card recap" style={{ padding: 14, marginTop: 16, boxShadow: 'none' }}>
            <img src={type === 'DSP' ? IMG.dsp : IMG.rem} alt="" />
            <div>
              <b className="disp" style={{ fontSize: 17 }}>{type === 'DSP' ? 'Dépannage sur place' : 'Remorquage'} · {societe?.nom}</b>
              <div style={{ margin: '6px 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><Plaque v={plaque || '—'} /><span className="veh">{[marque, modele].filter(Boolean).join(' ')}</span></div>
              <div className="addr" style={{ margin: 0 }}><IcoPin /><span>{adresse.texte}</span></div>
              {type === 'REM' && <div style={{ marginTop: 6, fontSize: 14, color: 'var(--ink2)' }}>Livraison : {garage?.nom || dest.texte}</div>}
              {(panne || panneTxt) && <div style={{ marginTop: 6, fontSize: 14, color: 'var(--ink2)' }}>Panne : {[panne, panneTxt].filter(Boolean).join(' — ')}</div>}
            </div>
          </div>
        </>}

        {err && <p className="err" style={{ marginTop: 12 }}>{err}</p>}
        <div className="foot">
          {pas > 0 ? <button className="btn btn-ghost" onClick={() => setPas(pas - 1)}>← Retour</button> : <span />}
          <span style={{ flex: 1, textAlign: 'right', fontSize: 13, color: 'var(--mute)' }}>{manque.length ? 'Encore : ' + manque.join(', ') : ''}</span>
          <button className="btn btn-red" disabled={!!manque.length || busy} onClick={() => pas < 2 ? (setPas(pas + 1), window.scrollTo({ top: 0, behavior: 'smooth' })) : envoyer()}>{pas < 2 ? 'Continuer →' : busy ? 'Envoi…' : 'Envoyer la demande'}</button>
        </div>
      </div>
    </div>
  )
}
