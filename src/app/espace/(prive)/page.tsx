'use client'
/* eslint-disable @next/next/no-img-element */
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useEspace } from './EspaceShell'
import { Frise, IMG, IcoDoc, IcoPin, IcoPlus, Pastille, Plaque, Progression, jour, typeLibelle, type MissionEspace } from '../_ui/suivi'

type Filtre = 'cours' | 'finies' | 'toutes'
const finieOuAnnulee = (m: MissionEspace) => m.suivi.ton === 'fini' || m.suivi.ton === 'annule'

export default function Suivi() {
  const { compte, societes } = useEspace()
  const [missions, setMissions] = useState<MissionEspace[] | null>(null)
  const [err, setErr] = useState('')
  const [filtre, setFiltre] = useState<Filtre>('cours')
  const [soc, setSoc] = useState('')
  const [q, setQ] = useState('')
  const [ouverte, setOuverte] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  const charger = useCallback(async () => {
    try {
      const r = await fetch('/api/espace/missions', { cache: 'no-store' })
      if (r.status === 401) { location.href = '/espace/connexion'; return }
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setMissions(j.missions); setErr('')
    } catch (e: any) { setErr(e.message || 'Connexion impossible') }
  }, [])
  useEffect(() => { charger(); const t = setInterval(charger, 30_000); return () => clearInterval(t) }, [charger])
  const montrer = (t: string) => { setToast(t); setTimeout(() => setToast(''), 2800) }

  const toutes = useMemo(() => (missions || []).filter(m => !soc || m.societe?.id === soc), [missions, soc])
  const liste = toutes.filter(m => (filtre === 'toutes' || (filtre === 'finies' ? finieOuAnnulee(m) : !finieOuAnnulee(m)))
    && (!q || `${m.plaque} ${m.vehicule} ${m.adresse} ${m.numero} ${m.reference || ''}`.toLowerCase().includes(q.toLowerCase())))
  const debutMois = new Date(); debutMois.setDate(1); debutMois.setHours(0, 0, 0, 0)
  const kpi = {
    cours: toutes.filter(m => ['accepte', 'route', 'action'].includes(m.suivi.ton)).length,
    attente: toutes.filter(m => m.suivi.ton === 'attente').length,
    mois: toutes.filter(m => m.suivi.ton === 'fini' && m.suivi.termineeLe && new Date(m.suivi.termineeLe) >= debutMois).length,
  }
  const h = new Date().getHours()
  const detail = ouverte ? (missions || []).find(m => m.id === ouverte) || null : null

  return (
    <>
      <section className="hero">
        <img className="bg" src={IMG.route} alt="" />
        <div className="wrap">
          <div className="rise">
            <div className="hello">{h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir'} {compte.nom.split(/\s+/)[0]}</div>
            <h1>Vos interventions,<br />en direct.</h1>
            <p>Suivez chaque dépannage de la demande jusqu’à la livraison. Rapports et factures au même endroit.</p>
            <Link href="/espace/nouvelle" className="btn btn-red" style={{ marginTop: 14 }}><IcoPlus /> Commander une intervention</Link>
          </div>
          <div className="kpis">{([['En cours', kpi.cours], ['En attente', kpi.attente], ['Terminées ce mois', kpi.mois]] as [string, number][]).map(([l, v], i) => <Kpi key={l} label={l} valeur={v} delai={120 + i * 90} />)}</div>
        </div>
      </section>

      <div className="wrap">
        <div className="bar rise">
          <div className="seg">{([['cours', 'En cours'], ['finies', 'Terminées'], ['toutes', 'Toutes']] as [Filtre, string][]).map(([k, l]) => <button key={k} className={filtre === k ? 'on' : ''} onClick={() => setFiltre(k)}>{l}</button>)}</div>
          {societes.length > 1 && <>
            <button className={`chip ${!soc ? 'on' : ''}`} onClick={() => setSoc('')}>Toutes</button>
            {societes.map(s => <button key={s.id} className={`chip ${soc === s.id ? 'on' : ''}`} onClick={() => setSoc(s.id)}><span className="dot" style={{ background: s.couleur || '#d42a2a' }} />{s.nom}</button>)}
          </>}
          <div className="search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Plaque, adresse, n°…" />
          </div>
        </div>
        <p style={{ textAlign: 'right', fontSize: 12, color: err ? '#b42318' : 'var(--mute)', margin: '8px 4px 0', fontWeight: err ? 700 : 400 }}>
          {err || <><span className="live" style={{ color: 'var(--green)', display: 'inline-block', width: 8, height: 8, marginRight: 6 }} />Mis à jour en direct</>}
        </p>

        {missions === null && <div className="grid">{[0, 1, 2].map(i => <div key={i} className="card" style={{ height: 210, background: 'linear-gradient(90deg,#f1ebe4 25%,#f8f5f1 37%,#f1ebe4 63%)', backgroundSize: '400% 100%' }} />)}</div>}
        {missions !== null && (liste.length ? (
          <div className="grid">{liste.map((m, i) => <Carte key={m.id} m={m} i={i} onOpen={() => setOuverte(m.id)} />)}</div>
        ) : (
          <div className="card empty rise">
            <img src={IMG.vide} alt="" />
            <div>
              <h3 style={{ fontSize: 22 }}>{filtre === 'cours' ? 'Aucune intervention en cours' : 'Rien à afficher ici'}</h3>
              <p style={{ color: 'var(--ink2)' }}>{filtre === 'cours' ? 'Tout roule. Besoin d’un dépannage ou d’un remorquage ? Nous arrivons.' : 'Changez de filtre ou de recherche.'}</p>
              {filtre === 'cours' && <Link href="/espace/nouvelle" className="btn btn-red">Commander une intervention</Link>}
            </div>
          </div>
        ))}
      </div>

      {detail && <Detail m={detail} onClose={() => setOuverte(null)} onChange={async (t) => { montrer(t); await charger() }} />}
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}

function Kpi({ label, valeur, delai }: { label: string; valeur: number; delai: number }) {
  const [v, setV] = useState(0)
  useEffect(() => {
    let raf = 0; const t0 = performance.now()
    const st = (t: number) => { const p = Math.min(1, (t - t0) / 700); setV(Math.round(valeur * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(st) }
    raf = requestAnimationFrame(st); return () => cancelAnimationFrame(raf)
  }, [valeur])
  return <div className="kpi rise" style={{ animationDelay: `${delai}ms` }}><b>{v}</b><span>{label}</span></div>
}

function Carte({ m, i, onOpen }: { m: MissionEspace; i: number; onOpen: () => void }) {
  return (
    <button className="card m" style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }} onClick={onOpen}>
      <span className="stripe" style={{ background: m.societe?.couleur || '#d42a2a' }} />
      <div className="m-head">
        <span className="m-ico"><img src={m.suivi.type === 'DSP' ? IMG.dsp : IMG.rem} alt="" /></span>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><Plaque v={m.plaque} /><span className="veh">{m.vehicule}</span></div>
          <div className="sub">{typeLibelle(m.suivi.type)} · n° {m.numero}</div>
        </div>
      </div>
      <div className="addr"><IcoPin /><span>{m.adresse}</span></div>
      <Progression etapes={m.suivi.etapes} annulee={m.suivi.ton === 'annule'} />
      <div className="row"><Pastille ton={m.suivi.ton} libelle={m.suivi.libelle} /><span className="when">Demandée {jour(m.recueLe)}</span></div>
      {(m.rapport || m.facture || m.photos.length > 0) && (
        <div className="docs">{m.rapport && <span>Rapport</span>}{m.facture && <span className="f">Facture {m.facture.numero}</span>}{m.photos.length > 0 && <span>Photos</span>}</div>
      )}
    </button>
  )
}

function Detail({ m, onClose, onChange }: { m: MissionEspace; onClose: () => void; onChange: (t: string) => void }) {
  const [annul, setAnnul] = useState(false)
  const [motif, setMotif] = useState('')
  const [busy, setBusy] = useState(false)
  const [photo, setPhoto] = useState<string | null>(null)
  useEffect(() => { const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f) }, [onClose])
  const annuler = async () => {
    setBusy(true)
    const r = await fetch(`/api/espace/missions/${m.id}/annulation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motif }) })
    const j = await r.json().catch(() => ({}))
    setBusy(false); setAnnul(false)
    onChange(r.ok ? j.message : j.error || 'Erreur')
  }
  return (
    <div className="scrim">
      <aside className="drawer">
        <div className="dhead">
          <img src={m.suivi.type === 'DSP' ? IMG.dsp : IMG.rem} alt="" />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div className="sub" style={{ color: '#ffcfb4' }}>{typeLibelle(m.suivi.type)} · n° {m.numero}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}><Plaque v={m.plaque} /><span className="disp" style={{ fontSize: 20, fontWeight: 800 }}>{m.vehicule}</span></div>
            </div>
            <button className="x" onClick={onClose} aria-label="Fermer">✕</button>
          </div>
          <div style={{ marginTop: 14 }}><Pastille ton={m.suivi.ton} libelle={m.suivi.libelle} /></div>
        </div>

        <div className="card sec" style={{ padding: 18 }}><h3>Suivi</h3><Frise etapes={m.suivi.etapes} /></div>

        <div className="card sec" style={{ padding: 18 }}>
          <h3>Détails</h3>
          <dl className="kv">
            <dt>Lieu d’intervention</dt><dd>{m.adresse}</dd>
            {m.destination && <><dt>Livraison</dt><dd>{m.destination}</dd></>}
            <dt>Demandée</dt><dd>{jour(m.recueLe)}</dd>
            {m.prevuLe && <><dt>Prévue</dt><dd>{jour(m.prevuLe)}</dd></>}
            {m.panne && <><dt>Panne signalée</dt><dd>{m.panne}</dd></>}
            {m.contact && <><dt>Contact sur place</dt><dd>{m.contact.nom}{m.contact.tel && <> · <a href={`tel:${m.contact.tel.replace(/\s/g, '')}`} style={{ color: 'var(--red)' }}>{m.contact.tel}</a></>}</dd></>}
            {m.reference && <><dt>Votre référence</dt><dd>{m.reference}</dd></>}
            {m.commandePar && <><dt>Commandée par</dt><dd>{m.commandePar}</dd></>}
            {m.societe && <><dt>Société</dt><dd>{m.societe.nom}</dd></>}
          </dl>
        </div>

        {m.messageChauffeur && (
          <div className="card sec" style={{ padding: 18 }}>
            <h3>Message pour le chauffeur</h3>
            <p style={{ margin: '0 0 10px', fontWeight: 600 }}>« {m.messageChauffeur.texte} »</p>
            {m.messageChauffeur.confirme ? <span className="pill t-fini">✓ Lu et confirmé par le chauffeur</span> : <span className="pill t-attente">Le chauffeur le confirmera en acceptant la mission</span>}
          </div>
        )}

        {m.photos.length > 0 && (
          <div className="card sec" style={{ padding: 18 }}>
            <h3>Photos du chauffeur</h3>
            <div className="photos">{m.photos.map(src => <button key={src} onClick={() => setPhoto(src)} style={{ padding: 0 }}><img src={src} alt="Photo du véhicule" /></button>)}</div>
          </div>
        )}

        <div className="card sec" style={{ padding: 18 }}>
          <h3>Documents</h3>
          <DocLigne on={m.rapport} href={`/api/espace/missions/${m.id}/rapport`} titre="Rapport d’intervention" sous={m.rapport ? 'Photos, constat et signature' : 'Disponible à la fin de l’intervention'} />
          <DocLigne on={!!m.facture} href={`/api/espace/missions/${m.id}/facture`} titre={m.facture ? `Facture ${m.facture.numero}` : 'Facture'} sous={m.facture ? 'PDF' : m.rapport ? 'Disponible dès son envoi' : 'Après l’intervention'} />
          {m.avoir && <DocLigne on href={`/api/espace/missions/${m.id}/avoir`} titre={`Note de crédit ${m.avoir.numero}`} sous="PDF" />}
        </div>

        {m.annulable && (
          <div className="sec" style={{ textAlign: 'center', paddingBottom: 30 }}>
            {m.annulationEnCours ? <p style={{ color: 'var(--ink2)', fontWeight: 600 }}>Demande d’annulation en cours d’examen : notre équipe vous répond rapidement.</p>
              : annul ? (
                <div className="card" style={{ padding: 16, textAlign: 'left' }}>
                  <b>Annuler cette intervention ?</b>
                  <p style={{ color: 'var(--ink2)', fontSize: 14, margin: '6px 0 10px' }}>{m.suivi.ton === 'attente' ? 'Elle n’est pas encore validée : elle est annulée tout de suite, sans frais.' : 'Elle est déjà en cours : notre équipe examine votre demande et vous répond rapidement.'}</p>
                  <textarea className="input" placeholder="Motif (facultatif)" value={motif} onChange={e => setMotif(e.target.value)} />
                  <div className="foot"><button className="btn btn-ghost" onClick={() => setAnnul(false)}>Garder</button><button className="btn btn-red" disabled={busy} onClick={annuler}>{busy ? 'Envoi…' : 'Confirmer l’annulation'}</button></div>
                </div>
              ) : <button className="btn btn-ghost" onClick={() => setAnnul(true)}>Demander l’annulation</button>}
          </div>
        )}
        <div style={{ height: 30 }} />
      </aside>
      {photo && (
        <div className="modal" style={{ zIndex: 95 }}>
          <div style={{ position: 'relative', maxWidth: 900, width: '100%' }}>
            <img src={photo} alt="Photo du véhicule" style={{ width: '100%', borderRadius: 18, maxHeight: '80vh', objectFit: 'contain', background: '#000' }} />
            <button className="x" style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(0,0,0,.55)' }} onClick={() => setPhoto(null)} aria-label="Fermer">✕</button>
          </div>
        </div>
      )}
    </div>
  )
}

function DocLigne({ on, href, titre, sous }: { on: boolean; href: string; titre: string; sous: string }) {
  return (
    <div className={`doc ${on ? '' : 'off'}`}>
      <span className="ic"><IcoDoc /></span>
      {on ? <a href={href} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', minWidth: 0 }}><b>{titre}</b><small>{sous}</small></a> : <div><b>{titre}</b><small>{sous}</small></div>}
      {on && <a className="dl" href={`${href}?dl=1`} aria-label="Télécharger"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 4v11m-4-4 4 4 4-4M5 20h14" /></svg></a>}
    </div>
  )
}
