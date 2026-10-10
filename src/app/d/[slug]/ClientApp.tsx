'use client'
// App des clients d'un garage partenaire (Olivier 10/10/2026, prototype validé) : inscription une fois, code par mail,
// commande en un geste avec la position du téléphone, estimation avant d'envoyer, suivi des étapes.
// Affichée « Verviers Dépannage », « avec <garage> » en partenaire : c'est notre tarif et notre paiement.
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '@/components/AddressField'
import AdresseInline, { type AdresseChoisie } from '../../espace/_ui/AdresseInline'
import { Frise, Plaque, IMG, type Etape } from '../../espace/_ui/suivi'

interface Client { prenom: string; nom: string; plaque: string; marque: string | null; modele: string | null; assistance: boolean; garage: string | null }
interface Commande {
  id: string; numero: number; adresse: string | null; panne: string | null
  suivi: { statut: string; libelle: string; etapes: Etape[] }
  aPayer: number | null; deplacementPourRien: boolean; annulable: boolean; annulationEnCours: boolean; parti: boolean
}
interface Etat { actif: boolean; deplacement: number | null; garages: { id: string; nom: string; adresse: string }[]; garage: { nom: string; couleur: string | null }; client: Client | null; commande: Commande | null }

const PANNES = ['Ne démarre pas', 'Batterie', 'Crevaison', 'Accident', 'Bruit / fumée', 'Clés enfermées', 'Autre']
const eur = (v: number) => v.toLocaleString('fr-BE', { style: 'currency', currency: 'EUR' })
const vide = { prenom: '', nom: '', tel: '', email: '', adresse: '', plaque: '', marque: '', modele: '' }

export default function ClientApp({ slug, garage, tel }: { slug: string; garage: { nom: string; couleur: string | null }; tel: string }) {
  const [etat, setEtat] = useState<Etat | null>(null)
  const [ecran, setEcran] = useState<'accueil' | 'inscription' | 'reconnexion' | 'code' | 'commande'>('accueil')
  const [f, setF] = useState(vide)
  const [garageId, setGarageId] = useState('')
  const [code, setCode] = useState(['', '', '', '', '', ''])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const api = `/api/d/${slug}`

  const charger = useCallback(async () => {
    const r = await fetch(api, { cache: 'no-store' }).then(x => x.json()).catch(() => null)
    if (r && !r.error) setEtat(r)
  }, [api])
  useEffect(() => { charger() }, [charger])
  // Suivi : rafraîchi toutes les 20 s tant qu'une demande est en cours.
  useEffect(() => {
    if (!etat?.commande || ['terminee', 'annulee'].includes(etat.commande.suivi.statut)) return
    const t = setInterval(charger, 20_000)
    return () => clearInterval(t)
  }, [etat?.commande, charger])
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(''), 2800) }

  const post = async (url: string, body: any) => {
    setBusy(true); setErr('')
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || 'Une erreur est survenue. Réessayez.'); return null }
      return j
    } catch { setErr('Pas de connexion. Réessayez.'); return null } finally { setBusy(false) }
  }

  const avec = (
    <span className="dcl-avec" style={{ color: garage.couleur || '#2f6fde', background: `${garage.couleur || '#2f6fde'}1a` }}>avec {garage.nom}</span>
  )
  const tete = (
    <header className="dcl-co">
      <span className="lg"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17h2m12 0h4v-4l-3-4h-5v8M3 17V7h10v10" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /></svg></span>
      <div><small>Dépannage 24 h/24</small><b>Verviers Dépannage</b></div>
      {avec}
    </header>
  )
  const pied = (
    <footer className="dcl-foot">
      {tel ? <>Urgence ou doute ? Appelez Verviers Dépannage 24 h/24 : <b style={{ color: 'var(--ink)', userSelect: 'all' }}>{tel}</b></> : 'Verviers Dépannage, 24 h/24'}
      {etat?.client && <div style={{ marginTop: 10 }}><button className="link" style={{ minHeight: 44 }} onClick={async () => { await fetch(`${api}/compte`, { method: 'DELETE' }); setF(vide); setEcran('accueil'); charger() }}>Se déconnecter</button></div>}
    </footer>
  )
  const page = (corps: React.ReactNode) => (
    <div className="dcl-app">
      {tete}{corps}{pied}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )

  if (!etat) return page(<div className="dcl-pad"><p className="dcl-sub">Chargement…</p></div>)
  if (!etat.actif) return page(
    <div className="dcl-pad"><div className="dcl-card dcl-pad" style={{ marginTop: 20, textAlign: 'center' }}>
      <h3>Service indisponible</h3>
      <p className="dcl-sub">Ce service n’est pas activé par votre garage {garage.nom}. {tel ? `Appelez Verviers Dépannage au ${tel}.` : ''}</p>
    </div></div>,
  )

  // ── Pas connecté ──
  if (!etat.client) {
    if (ecran === 'inscription') {
      const champ = (k: keyof typeof vide, label: string, props: any = {}) => (
        <label className="field"><span>{label}</span><input className="input" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} {...props} /></label>
      )
      const garages = etat.garages
      const gChoisi = garages.length === 1 ? garages[0].id : garageId
      const pret = Object.values(f).every(v => v.trim()) && f.email.includes('@') && (!garages.length || !!gChoisi)
      return page(
        <div className="dcl-pad rise">
          <h2>Votre inscription</h2>
          <p className="dcl-sub">Une seule fois. Ces coordonnées servent aussi à la facture de Verviers Dépannage si un dépannage est à votre charge.</p>
          <div className="dcl-stack">
            <div className="dcl-two">{champ('prenom', 'Prénom', { autoComplete: 'given-name' })}{champ('nom', 'Nom', { autoComplete: 'family-name' })}</div>
            {champ('tel', 'Téléphone', { type: 'tel', autoComplete: 'tel', placeholder: '04.. .. .. ..' })}
            {champ('email', 'Adresse mail', { type: 'email', autoComplete: 'email' })}
            {champ('adresse', 'Votre adresse', { autoComplete: 'street-address', placeholder: 'Rue, numéro, code postal, localité' })}
            <h3 style={{ marginTop: 6 }}>Votre véhicule</h3>
            <label className="field"><span>Plaque</span><div className="platein"><i>B</i><input value={f.plaque} onChange={e => setF({ ...f, plaque: e.target.value.toUpperCase().replace(/\s/g, '') })} placeholder="1ABC234" /></div></label>
            <div className="dcl-two">{champ('marque', 'Marque', { placeholder: 'Kia' })}{champ('modele', 'Modèle', { placeholder: 'Ceed' })}</div>
            {garages.length > 0 && (
              <div>
                <h3 style={{ marginTop: 6 }}>Votre garage {garage.nom}</h3>
                <p className="dcl-sub">{garages.length > 1 ? 'Celui qui suit votre véhicule. En cas de remorquage, votre véhicule y est conduit.' : 'En cas de remorquage, votre véhicule y est conduit.'}</p>
                <div className="dcl-gar" role="radiogroup">
                  {garages.map(g => (
                    <button key={g.id} type="button" role="radio" aria-checked={gChoisi === g.id} className={gChoisi === g.id ? 'on' : ''} onClick={() => setGarageId(g.id)}>
                      <span className="rd" /><span><b>{g.nom}</b><small>{g.adresse}</small></span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {err && <p className="err">{err}</p>}
            <button className="btn btn-red" disabled={!pret || busy} onClick={async () => { if (await post(`${api}/compte`, { etape: 'inscrire', ...f, garageId: gChoisi })) { setCode(['', '', '', '', '', '']); setEcran('code') } }}>
              {busy ? 'Envoi…' : 'Recevoir mon code par mail'}
            </button>
            {!pret && <p className="dcl-small">{garages.length > 1 && !gChoisi && Object.values(f).every(v => v.trim()) ? 'Choisissez votre garage.' : 'Tous les champs sont obligatoires.'}</p>}
            <button className="link" style={{ minHeight: 44 }} onClick={() => { setErr(''); setEcran('accueil') }}>Retour</button>
          </div>
        </div>,
      )
    }
    if (ecran === 'reconnexion') {
      return page(
        <div className="dcl-pad rise">
          <h2>Déjà inscrit ?</h2>
          <p className="dcl-sub">Indiquez l’adresse mail de votre inscription : vous recevez un code.</p>
          <div className="dcl-stack">
            <label className="field"><span>Adresse mail</span><input className="input" type="email" autoComplete="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></label>
            {err && <p className="err">{err}</p>}
            <button className="btn btn-red" disabled={!f.email.includes('@') || busy} onClick={async () => {
              const j = await post(`${api}/compte`, { etape: 'code', email: f.email })
              if (j?.inconnu) setErr('Aucune inscription avec cette adresse. Inscrivez-vous.')
              else if (j) { setCode(['', '', '', '', '', '']); setEcran('code') }
            }}>{busy ? 'Envoi…' : 'Recevoir mon code'}</button>
            <button className="link" style={{ minHeight: 44 }} onClick={() => { setErr(''); setEcran('accueil') }}>Retour</button>
          </div>
        </div>,
      )
    }
    if (ecran === 'code') {
      return page(
        <div className="dcl-pad rise">
          <h2>Vérifiez vos mails</h2>
          <p className="dcl-sub">Code à 6 chiffres envoyé à <b>{f.email}</b>. Pensez à regarder dans les indésirables.</p>
          <CodeSaisie code={code} setCode={setCode} onComplet={async c => {
            if (await post(`${api}/compte`, { etape: 'verifier', email: f.email, code: c })) { flash('C’est confirmé'); setEcran('accueil'); charger() }
            else setCode(['', '', '', '', '', ''])
          }} />
          {err && <p className="err" style={{ marginTop: 10 }}>{err}</p>}
          <button className="link" style={{ minHeight: 44, marginTop: 8 }} disabled={busy} onClick={() => post(`${api}/compte`, { etape: 'code', email: f.email }).then(j => j && flash('Nouveau code envoyé'))}>Renvoyer un code</button>
        </div>,
      )
    }
    return page(
      <>
        <div className="dcl-hero"><img src={IMG.nuit} alt="" /><div><h1>En panne ? On arrive.</h1><p>Verviers Dépannage, partenaire de votre garage {garage.nom} : inscrivez-vous une fois, commandez votre dépannage en 30 secondes.</p></div></div>
        <div className="dcl-pad">
          <button className="btn btn-red" onClick={() => { setErr(''); setEcran('inscription') }}>Je m’inscris</button>
          <p className="dcl-small">Une seule fois : vos coordonnées et votre véhicule.</p>
          <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => { setErr(''); setEcran('reconnexion') }}>Je suis déjà inscrit</button>
        </div>
      </>,
    )
  }

  // ── Connecté ──
  const c = etat.client
  const cmd = etat.commande
  const enCours = cmd && !['terminee', 'annulee'].includes(cmd.suivi.statut)
  const bonjour = (
    <>
      <p className="dcl-veh">Bonjour <b style={{ color: 'var(--ink)' }}>{c.prenom}</b> · <Plaque v={c.plaque} /> {[c.marque, c.modele].filter(Boolean).join(' ')}</p>
      {c.garage && <p className="dcl-sub">Votre garage : <b style={{ color: 'var(--ink)' }}>{c.garage}</b></p>}
      {c.assistance && <div className="dcl-statut ok"><span className="ic">🛡️</span><div><b>Assistance {garage.nom}</b><br /><span style={{ fontSize: 13 }}>Vos dépannages sont pris en charge par votre garage.</span></div></div>}
    </>
  )

  if (ecran === 'commande' && !enCours) {
    return page(<Commander api={api} client={c} garage={garage.nom} deplacement={etat.deplacement} onRetour={() => setEcran('accueil')} onEnvoye={() => { flash('Demande envoyée'); setEcran('accueil'); charger() }} />)
  }

  if (cmd) {
    const annulee = cmd.suivi.statut === 'annulee'
    const finie = cmd.suivi.statut === 'terminee'
    return page(
      <div className="dcl-pad rise">
        {bonjour}
        <div className="dcl-card" style={{ marginTop: 14 }}>
          <img src={annulee ? IMG.vide : IMG.succes} alt="" />
          <div className="dcl-pad">
            <h2 style={{ fontSize: 20 }}>{annulee ? 'Demande annulée' : finie ? 'Intervention terminée' : cmd.suivi.statut === 'recue' ? 'C’est envoyé, on s’en occupe' : cmd.suivi.libelle}</h2>
            <p className="dcl-sub" style={{ margin: '4px 0 12px' }}>
              {annulee ? 'Votre demande est annulée.' : finie ? 'Merci de votre confiance.' : cmd.annulationEnCours ? 'Votre annulation est en cours de traitement.' : 'Suivez les étapes ici. Gardez votre téléphone près de vous : le chauffeur peut vous appeler.'}
            </p>
            {!annulee && <Frise etapes={cmd.suivi.etapes} />}
          </div>
        </div>
        {cmd.aPayer != null && !annulee && (
          <div className="dcl-prix">
            <span>{finie ? 'Montant de l’intervention' : 'À régler au chauffeur'}<small>{cmd.deplacementPourRien ? 'déplacement pour rien · TVAC' : 'estimation · TVAC · le chauffeur confirme le montant sur place'}</small></span>
            <b>{finie ? '' : '± '}{eur(cmd.aPayer)}</b>
          </div>
        )}
        {enCours && cmd.annulable && <Annuler api={api} cmd={cmd} assistance={c.assistance} deplacement={etat.deplacement} onFait={m => { flash(m); charger() }} />}
        {enCours && !c.assistance && <p className="dcl-small">Facture Verviers Dépannage à votre nom, remise après l’intervention.</p>}
        {!enCours && <button className="dcl-big" onClick={() => setEcran('commande')}><img src={IMG.route} alt="" /><div><b>J’ai besoin d’un dépannage</b><span>On vous localise automatiquement</span></div></button>}
      </div>,
    )
  }

  return page(
    <div className="dcl-pad rise">
      {bonjour}
      <button className="dcl-big" onClick={() => setEcran('commande')}><img src={IMG.route} alt="" /><div><b>J’ai besoin d’un dépannage</b><span>On vous localise automatiquement</span></div></button>
    </div>,
  )
}

function CodeSaisie({ code, setCode, onComplet }: { code: string[]; setCode: (c: string[]) => void; onComplet: (c: string) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  useEffect(() => { refs.current[0]?.focus() }, [])
  const maj = (i: number, v: string) => {
    const chiffres = v.replace(/\D/g, '')
    const n = [...code]
    if (chiffres.length > 1) { chiffres.slice(0, 6).split('').forEach((d, k) => { if (k < 6) n[k] = d }) } else n[i] = chiffres
    setCode(n)
    if (chiffres && i < 5) refs.current[Math.min(5, i + chiffres.length)]?.focus()
    if (n.every(Boolean)) onComplet(n.join(''))
  }
  return (
    <div className="otp" style={{ marginTop: 14 }}>
      {code.map((d, i) => (
        <input key={i} ref={el => { refs.current[i] = el }} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} value={d} aria-label={`Chiffre ${i + 1}`}
          onChange={e => maj(i, e.target.value)} onKeyDown={e => { if (e.key === 'Backspace' && !d && i > 0) refs.current[i - 1]?.focus() }} />
      ))}
    </div>
  )
}

function Commander({ api, client, garage, deplacement, onRetour, onEnvoye }: { api: string; client: Client; garage: string; deplacement: number | null; onRetour: () => void; onEnvoye: () => void }) {
  const [pos, setPos] = useState<AdresseChoisie>({ texte: '', lat: null, lng: null })
  const [gps, setGps] = useState<'cherche' | 'ok' | 'refus'>('cherche')
  const [panne, setPanne] = useState('')
  const [symptome, setSymptome] = useState('')
  const [prix, setPrix] = useState<{ dsp: number | null; rem: number | null; garage: string | null; charge: boolean }>({ dsp: null, rem: null, garage: null, charge: false })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const carte = useRef<HTMLDivElement>(null)
  const gm = useRef<{ map: any; marker: any } | null>(null)
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''

  const adresseDe = useCallback(async (lat: number, lng: number) => {
    try {
      await loadGoogleMaps(key)
      new (window as any).google.maps.Geocoder().geocode({ location: { lat, lng } }, (r: any[] | null) => setPos({ texte: r?.[0]?.formatted_address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng }))
    } catch { setPos({ texte: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng }) }
  }, [key])

  // Position du téléphone dès l'ouverture.
  useEffect(() => {
    if (!navigator.geolocation) { setGps('refus'); return }
    navigator.geolocation.getCurrentPosition(p => { setGps('ok'); adresseDe(p.coords.latitude, p.coords.longitude) }, () => setGps('refus'), { enableHighAccuracy: true, timeout: 15000 })
  }, [adresseDe])

  // Carte avec un point déplaçable.
  useEffect(() => {
    if (pos.lat == null || pos.lng == null || !carte.current) return
    const p = { lat: pos.lat, lng: pos.lng }
    loadGoogleMaps(key).then(() => {
      const g = (window as any).google
      if (!gm.current) {
        const map = new g.maps.Map(carte.current, { center: p, zoom: 16, disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy', clickableIcons: false })
        const marker = new g.maps.Marker({ position: p, map, draggable: true })
        marker.addListener('dragend', () => { const q = marker.getPosition(); adresseDe(q.lat(), q.lng()) })
        gm.current = { map, marker }
      } else {
        gm.current.marker.setPosition(p); gm.current.map.panTo(p)
      }
    }).catch(() => {})
  }, [pos.lat, pos.lng, key, adresseDe])

  // Estimation (client sans assistance) à chaque nouvelle position.
  useEffect(() => {
    if (client.assistance || pos.lat == null || pos.lng == null) return
    setPrix({ dsp: null, rem: null, garage: null, charge: true })
    const t = setTimeout(() => {
      fetch(`${api}/estimation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat: pos.lat, lng: pos.lng }) })
        .then(r => r.json()).then(j => setPrix({ dsp: j?.dsp ?? null, rem: j?.rem ?? null, garage: j?.garage ?? null, charge: false })).catch(() => setPrix({ dsp: null, rem: null, garage: null, charge: false }))
    }, 400)
    return () => clearTimeout(t)
  }, [pos.lat, pos.lng, client.assistance, api])

  const pret = pos.lat != null && !!panne && (panne !== 'Autre' || !!symptome.trim())
  const envoyer = async () => {
    setBusy(true); setErr('')
    const r = await fetch(`${api}/commande`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adresse: pos.texte, lat: pos.lat, lng: pos.lng, panne, symptome }) }).catch(() => null)
    const j = await r?.json().catch(() => ({}))
    setBusy(false)
    if (!r?.ok) return setErr(j?.error || 'La demande n’a pas pu partir. Appelez-nous.')
    onEnvoye()
  }

  return (
    <div className="dcl-pad rise">
      <h2 style={{ fontSize: 20 }}>Où êtes-vous ?</h2>
      <div className="dcl-map">
        <div ref={carte} style={{ position: 'absolute', inset: 0 }} />
        {pos.lat == null && <div className="vide">{gps === 'cherche' ? 'Localisation de votre téléphone…' : 'Position indisponible : saisissez l’adresse ci-dessous.'}</div>}
      </div>
      <p className="dcl-sub" style={{ marginTop: 8 }}>{pos.lat != null ? 'Déplacez le point si besoin, ou corrigez l’adresse :' : 'Adresse de la panne :'}</p>
      <div style={{ marginTop: 6 }}><AdresseInline valeur={pos} onChange={setPos} placeholder="Rue, numéro, localité" gps={gps === 'refus'} /></div>

      <h3 style={{ marginTop: 18 }}>Que se passe-t-il ?</h3>
      <div className="dcl-chips">{PANNES.map(x => <button key={x} className={`dcl-chip ${panne === x ? 'on' : ''}`} onClick={() => setPanne(x)}>{x}</button>)}</div>
      {panne && <input className="input rise" style={{ marginTop: 10 }} value={symptome} onChange={e => setSymptome(e.target.value)} placeholder={panne === 'Autre' ? 'Décrivez les symptômes : bruit, voyant, odeur… (obligatoire)' : 'Un détail utile ? (facultatif)'} />}

      {client.assistance ? (
        <div className="dcl-statut ok"><span className="ic">🛡️</span><div><b>Pris en charge par {garage}</b><br /><span style={{ fontSize: 13 }}>Rien à payer.</span></div></div>
      ) : (
        <>
          <div className="dcl-prix">
            <span>Dépannage sur place<small>déplacement et intervention · TVAC · à régler au chauffeur</small></span>
            <b>{prix.charge ? '…' : prix.dsp != null ? `± ${eur(prix.dsp)}` : pos.lat == null ? '—' : 'sur place'}</b>
          </div>
          {(prix.charge || prix.rem != null) && (
            <div className="dcl-prix" style={{ marginTop: 8, background: '#f3ece4', color: 'var(--ink2)' }}>
              <span>Si remorquage{prix.garage ? ` jusqu’à ${prix.garage}` : ''}<small>si le véhicule ne peut pas être réparé sur place · TVAC</small></span>
              <b>{prix.charge ? '…' : `± ${eur(prix.rem!)}`}</b>
            </div>
          )}
          <p className="dcl-note">Estimations Verviers Dépannage. C’est le chauffeur qui décide sur place s’il faut remorquer, et il vous confirme le montant avant de charger. Si vous annulez après le départ du dépanneur, ou si vous êtes absent à son arrivée, le déplacement vous est facturé{deplacement ? ` (${eur(deplacement)} TVAC)` : ''}.</p>
        </>
      )}
      {err && <p className="err" style={{ marginTop: 10 }}>{err}</p>}
      <button className="btn btn-red" style={{ marginTop: 14 }} disabled={!pret || busy} onClick={envoyer}>{busy ? 'Envoi…' : 'Envoyer ma demande'}</button>
      {!pret && <p className="dcl-small">{pos.lat == null ? 'Indiquez où vous êtes.' : !panne ? 'Choisissez ce qui se passe.' : 'Décrivez les symptômes.'}</p>}
      <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={onRetour}>Retour</button>
    </div>
  )
}

function Annuler({ api, cmd, assistance, deplacement, onFait }: { api: string; cmd: Commande; assistance: boolean; deplacement: number | null; onFait: (m: string) => void }) {
  const [conf, setConf] = useState(false)
  const [busy, setBusy] = useState(false)
  const frais = cmd.parti && !assistance
  if (!conf) return <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => setConf(true)}>Annuler ma demande{frais && deplacement ? ` (déplacement facturé ${eur(deplacement)})` : ''}</button>
  return (
    <div className="dcl-card dcl-pad rise" style={{ marginTop: 12 }}>
      <b>Annuler votre demande ?</b>
      <p className="dcl-sub" style={{ margin: '4px 0 12px' }}>{frais ? `Le dépanneur est déjà en route : le déplacement vous sera facturé${deplacement ? ` (${eur(deplacement)} TVAC)` : ''}.` : 'Sans frais : le dépanneur n’est pas encore parti.'}</p>
      <div className="dcl-two">
        <button className="btn btn-ghost" onClick={() => setConf(false)}>Non, garder</button>
        <button className="btn btn-red" disabled={busy} onClick={async () => {
          setBusy(true)
          const r = await fetch(`${api}/commande/${cmd.id}/annulation`, { method: 'POST' }).catch(() => null)
          const j = await r?.json().catch(() => ({}))
          setBusy(false); setConf(false)
          onFait(r?.ok ? j.message : j?.error || 'Annulation impossible. Appelez-nous.')
        }}>{busy ? '…' : 'Oui, annuler'}</button>
      </div>
    </div>
  )
}
