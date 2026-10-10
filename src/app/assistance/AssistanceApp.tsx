'use client'
/* eslint-disable @next/next/no-img-element */
// VD Assistance — l'app des clients des garages partenaires (Olivier 10/10/2026).
// Un compte par personne, plusieurs véhicules ; chaque véhicule est relié à un garage partenaire (choisi parmi ses
// sites, jamais une adresse libre) et ne change de garage que par notre dispatch. Commande : choisir le véhicule,
// « Me localiser » (jamais de suivi permanent), la panne, voir les estimations, envoyer. Suivi des étapes, et
// notifications si le client les accepte. Affiché « Verviers Dépannage » : c'est notre tarif et notre paiement.
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '@/components/AddressField'
import AdresseInline, { type AdresseChoisie } from '../espace/_ui/AdresseInline'
import { Frise, Plaque, IMG, type Etape } from '../espace/_ui/suivi'

interface Vehicule {
  id: string; plaque: string; marque: string | null; modele: string | null; assistance: boolean
  garage: { nom: string; adresse: string }; societe: { nom: string; couleur: string | null; actif: boolean }; deplacement: number | null
}
interface Commande {
  id: string; numero: number; adresse: string | null; panne: string | null; vehicule: string; plaque: string | null
  suivi: { statut: string; libelle: string; etapes: Etape[] }
  aPayer: number | null; aSaCharge: boolean; deplacementPourRien: boolean; annulable: boolean; annulationEnCours: boolean; parti: boolean
}
interface Etat { client: { prenom: string; nom: string; email: string } | null; vehicules: Vehicule[]; commande: Commande | null }
interface Partenaire { id: string; nom: string; couleur: string | null; slug: string; sites: { id: string; nom: string; adresse: string }[] }

// Icônes dessinées (pas d'emoji : rendu identique sur tous les téléphones).
const Ico = ({ d, c = 'currentColor', s = 22 }: { d: React.ReactNode; c?: string; s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>{d}</svg>
)
const IcoBouclier = (p: { c?: string; s?: number }) => <Ico {...p} d={<><path d="M12 3l7 3v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z" /><path d="M9 12l2 2 4-4" /></>} />
const IcoCarte = (p: { c?: string; s?: number }) => <Ico {...p} d={<><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18M7 15h3" /></>} />
const IcoTel = (p: { c?: string; s?: number }) => <Ico {...p} d={<><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18h2" /></>} />
const IcoCloche = (p: { c?: string; s?: number }) => <Ico {...p} d={<><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16z" /><path d="M10 20a2 2 0 0 0 4 0" /></>} />
const Pastille = ({ children, fond }: { children: React.ReactNode; fond: string }) => (
  <span style={{ width: 44, height: 44, borderRadius: 14, background: fond, display: 'grid', placeItems: 'center', flex: 'none' }}>{children}</span>
)

const API = '/api/assistance'
const PANNES = ['Ne démarre pas', 'Batterie', 'Crevaison', 'Accident', 'Bruit / fumée', 'Clés enfermées', 'Autre']
const eur = (v: number) => v.toLocaleString('fr-BE', { style: 'currency', currency: 'EUR' })
const PERSONNE = { prenom: '', nom: '', tel: '', email: '', adresse: '' }
const VEHICULE = { plaque: '', marque: '', modele: '', garageId: '' }
const slugDe = (texte: string): string | null => {
  const t = texte.trim()
  const m = t.match(/\/d\/([a-z0-9-]+)/i) || t.match(/[?&]garage=([a-z0-9-]+)/i)
  if (m) return m[1].toLowerCase()
  return /^[a-z0-9-]{2,40}$/i.test(t) ? t.toLowerCase() : null
}

async function poster(url: string, body: any): Promise<{ ok: boolean; j: any }> {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { ok: r.ok, j: await r.json().catch(() => ({})) }
  } catch { return { ok: false, j: { error: 'Pas de connexion. Réessayez.' } } }
}

export default function AssistanceApp({ contexte, tel, appStore }: { contexte: string | null; tel: string; appStore: string }) {
  const [etat, setEtat] = useState<Etat | null>(null)
  const [ecran, setEcran] = useState<'accueil' | 'inscription' | 'reconnexion' | 'code' | 'commande' | 'vehicules' | 'ajout'>('accueil')
  const [garageCtx, setGarageCtx] = useState<string | null>(contexte)
  const [partenaires, setPartenaires] = useState<Partenaire[] | null>(null)
  const [p, setP] = useState(PERSONNE)
  const [v, setV] = useState(VEHICULE)
  const [code, setCode] = useState(['', '', '', '', '', ''])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [suppr, setSuppr] = useState(false)

  const charger = useCallback(async () => {
    const r = await fetch(API, { cache: 'no-store' }).then(x => x.json()).catch(() => null)
    if (r && !r.error) setEtat(r)
  }, [])
  useEffect(() => { charger() }, [charger])
  useEffect(() => {
    if (!etat?.commande || ['terminee', 'annulee'].includes(etat.commande.suivi.statut)) return
    const t = setInterval(charger, 20_000)
    return () => clearInterval(t)
  }, [etat?.commande, charger])
  // Garages partenaires : ceux du lien ou QR code suivi, sinon tous.
  const chargerGarages = useCallback(async (slug: string | null) => {
    const r = await fetch(`${API}/garages${slug ? `?slug=${encodeURIComponent(slug)}` : ''}`, { cache: 'no-store' }).then(x => x.json()).catch(() => null)
    setPartenaires(r?.garages || [])
    return r
  }, [])
  useEffect(() => { chargerGarages(garageCtx) }, [garageCtx, chargerGarages])
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(''), 2800) }
  const post = async (url: string, body: any) => {
    setBusy(true); setErr('')
    const { ok, j } = await poster(url, body)
    setBusy(false)
    if (!ok) { setErr(j.error || 'Une erreur est survenue. Réessayez.'); return null }
    return j
  }

  // Installation : bouton natif sur Android ; lien App Store sur iPhone (hors app installée).
  const [installer, setInstaller] = useState<any>(null)
  const [plateforme, setPlateforme] = useState<'app' | 'ios' | 'autre'>('autre')
  useEffect(() => {
    const ua = navigator.userAgent
    const installee = /VDAssist\//.test(ua) || window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone
    setPlateforme(installee ? 'app' : /iPhone|iPad|iPod/.test(ua) ? 'ios' : 'autre')
    const h = (e: any) => { e.preventDefault(); setInstaller(e) }
    window.addEventListener('beforeinstallprompt', h)
    return () => window.removeEventListener('beforeinstallprompt', h)
  }, [])

  const ctx = garageCtx && partenaires?.length === 1 ? partenaires[0] : null
  const tete = (
    <header className="dcl-co">
      <span className="lg"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17h2m12 0h4v-4l-3-4h-5v8M3 17V7h10v10" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /></svg></span>
      <div><small>VD Assistance · 24 h/24</small><b>Verviers Dépannage</b></div>
      {ctx && !etat?.client && <span className="dcl-avec" style={{ color: ctx.couleur || '#2f6fde', background: `${ctx.couleur || '#2f6fde'}1a` }}>avec {ctx.nom}</span>}
    </header>
  )
  const installCarte = etat?.client && plateforme !== 'app' && (installer || (plateforme === 'ios' && appStore)) ? (
    <div className="dcl-card dcl-pad" style={{ margin: '0 16px 4px', display: 'flex', gap: 12, alignItems: 'center' }}>
      <Pastille fond="#fff1ef"><IcoTel c="#d42a2a" /></Pastille>
      <span style={{ flex: 1, fontSize: 14 }}><b>Gardez VD Assistance sur votre écran</b><br /><span style={{ color: 'var(--ink2)' }}>En cas de panne, un seul geste.</span></span>
      {installer
        ? <button className="btn btn-red" style={{ width: 'auto', minHeight: 44 }} onClick={async () => { installer.prompt(); await installer.userChoice.catch(() => null); setInstaller(null) }}>Installer</button>
        : <a className="btn btn-red" style={{ width: 'auto', minHeight: 44 }} href={appStore}>Télécharger</a>}
    </div>
  ) : null
  const pied = (
    <footer className="dcl-foot">
      {tel ? <>Urgence ou doute ? Appelez Verviers Dépannage 24 h/24 : <b style={{ color: 'var(--ink)', userSelect: 'all' }}>{tel}</b></> : 'Verviers Dépannage, 24 h/24'}
      <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0 16px' }}>
        {etat?.client && <button className="link" style={{ minHeight: 44 }} onClick={async () => { await fetch(`${API}/compte`, { method: 'DELETE' }); setP(PERSONNE); setEcran('accueil'); charger() }}>Se déconnecter</button>}
        {etat?.client && <button className="link" style={{ minHeight: 44 }} onClick={() => setSuppr(true)}>Supprimer mon compte</button>}
        <a className="link" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }} href="/assistance/confidentialite">Confidentialité</a>
      </div>
    </footer>
  )
  const page = (corps: React.ReactNode, onglets = false) => (
    <div className="dcl-app">
      {tete}
      {onglets && (
        <div className="dcl-pad" style={{ paddingBottom: 0 }}>
          <div className="seg" role="tablist">
            <button className={ecran !== 'vehicules' && ecran !== 'ajout' ? 'on' : ''} style={{ flex: 1 }} onClick={() => { setErr(''); setEcran('accueil') }}>Dépannage</button>
            <button className={ecran === 'vehicules' || ecran === 'ajout' ? 'on' : ''} style={{ flex: 1 }} onClick={() => { setErr(''); setEcran('vehicules') }}>Mes véhicules</button>
          </div>
        </div>
      )}
      {corps}{installCarte}{pied}
      {suppr && (
        <div className="modal">
          <div className="card">
            <h2 style={{ fontSize: 20 }}>Supprimer votre compte ?</h2>
            <p style={{ color: 'var(--ink2)' }}>Vos coordonnées et vos véhicules sont effacés, et vous êtes déconnecté. Les factures déjà établies restent conservées, comme la loi l’impose. Vous pourrez vous réinscrire à tout moment.</p>
            <div className="dcl-two">
              <button className="btn btn-ghost" onClick={() => setSuppr(false)}>Annuler</button>
              <button className="btn btn-red" disabled={busy} onClick={async () => { if (await post(`${API}/compte`, { etape: 'supprimer' })) { setSuppr(false); setP(PERSONNE); setEcran('accueil'); flash('Compte supprimé'); charger() } }}>Supprimer</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )

  if (!etat) return page(<div className="dcl-pad"><p className="dcl-sub">Chargement…</p></div>)

  // ───────────────────────── Pas connecté ─────────────────────────
  if (!etat.client) {
    if (ecran === 'inscription' && ctx) {
      const champ = (k: keyof typeof PERSONNE, label: string, props: any = {}) => (
        <label className="field"><span>{label}</span><input className="input" value={p[k]} onChange={e => setP({ ...p, [k]: e.target.value })} {...props} /></label>
      )
      const site = ctx.sites.length === 1 ? ctx.sites[0].id : v.garageId
      const pret = Object.values(p).every(x => x.trim()) && p.email.includes('@') && v.plaque && v.marque.trim() && v.modele.trim() && !!site
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
            <ChampsVehicule v={v} setV={setV} sites={ctx.sites} garage={ctx.nom} />
            {err && <p className="err">{err}</p>}
            <button className="btn btn-red" disabled={!pret || busy} onClick={async () => {
              const j = await post(`${API}/compte`, { etape: 'inscrire', ...p, vehicule: { ...v, garageId: site } })
              if (j?.dejaInscrit) { flash('Vous êtes déjà inscrit : entrez le code reçu, puis ajoutez ce véhicule.'); setCode(['', '', '', '', '', '']); setEcran('code') }
              else if (j) { setCode(['', '', '', '', '', '']); setEcran('code') }
            }}>{busy ? 'Envoi…' : 'Recevoir mon code par mail'}</button>
            {!pret && <p className="dcl-small">{!site && ctx.sites.length > 1 ? 'Choisissez le garage de votre véhicule.' : 'Tous les champs sont obligatoires.'}</p>}
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
            <label className="field"><span>Adresse mail</span><input className="input" type="email" autoComplete="email" value={p.email} onChange={e => setP({ ...p, email: e.target.value })} /></label>
            {err && <p className="err">{err}</p>}
            <button className="btn btn-red" disabled={!p.email.includes('@') || busy} onClick={async () => {
              const j = await post(`${API}/compte`, { etape: 'code', email: p.email })
              if (j?.inconnu) setErr('Aucune inscription avec cette adresse. Inscrivez-vous avec le QR code de votre garage.')
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
          <p className="dcl-sub">Code à 6 chiffres envoyé à <b>{p.email}</b>. Pensez à regarder dans les indésirables.</p>
          <CodeSaisie code={code} setCode={setCode} onComplet={async c => {
            if (await post(`${API}/compte`, { etape: 'verifier', email: p.email, code: c })) { flash('C’est confirmé'); setEcran('accueil'); charger() }
            else setCode(['', '', '', '', '', ''])
          }} />
          {err && <p className="err" style={{ marginTop: 10 }}>{err}</p>}
          <button className="link" style={{ minHeight: 44, marginTop: 8 }} disabled={busy} onClick={() => post(`${API}/compte`, { etape: 'code', email: p.email }).then(j => j && flash('Nouveau code envoyé'))}>Renvoyer un code</button>
        </div>,
      )
    }
    return page(
      <>
        <div className="dcl-hero"><img src={IMG.nuit} alt="" /><div><h1>En panne ? On arrive.</h1><p>{ctx ? `Verviers Dépannage, partenaire de votre garage ${ctx.nom} : inscrivez-vous une fois, commandez votre dépannage en 30 secondes.` : 'Le dépannage de votre garage partenaire, 24 h/24. Inscrivez-vous une fois, commandez en 30 secondes.'}</p></div></div>
        <div className="dcl-pad">
          {ctx ? (
            <>
              <button className="btn btn-red" onClick={() => { setErr(''); setEcran('inscription') }}>Je m’inscris</button>
              <p className="dcl-small">Une seule fois : vos coordonnées et votre véhicule.</p>
            </>
          ) : (
            <TrouverGarage onGarage={async slug => {
              const r = await chargerGarages(slug)
              if (r?.error) return r.error
              if (r?.inactif) return `${r.inactif} n’a pas encore activé ce service.`
              setGarageCtx(slug); return null
            }} partenaires={garageCtx ? [] : partenaires || []} />
          )}
          <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => { setErr(''); setEcran('reconnexion') }}>Je suis déjà inscrit</button>
          {garageCtx && !ctx && partenaires && <p className="err" style={{ marginTop: 10, textAlign: 'center' }}>Ce garage n’a pas encore activé le service.</p>}
        </div>
      </>,
    )
  }

  // ───────────────────────── Connecté ─────────────────────────
  const c = etat.client
  const vehicules = etat.vehicules
  const cmd = etat.commande
  const enCours = cmd && !['terminee', 'annulee'].includes(cmd.suivi.statut)
  // Arrivé par le QR code d'un garage où il n'a pas encore de véhicule : on lui propose d'en ajouter un.
  const proposerAjout = ctx && !vehicules.some(x => x.societe.nom === ctx.nom)

  if (ecran === 'ajout') {
    const choix = ctx ? [ctx] : partenaires || []
    const sites = choix.flatMap(s => s.sites.map(x => ({ ...x, nom: choix.length > 1 ? `${s.nom} — ${x.nom}` : x.nom })))
    const site = sites.length === 1 ? sites[0].id : v.garageId
    const pret = v.plaque && v.marque.trim() && v.modele.trim() && !!site
    return page(
      <div className="dcl-pad rise">
        <h2>Ajouter un véhicule</h2>
        <p className="dcl-sub">Chaque véhicule est relié à son garage : en cas de remorquage, il y est conduit.</p>
        <div className="dcl-stack">
          {sites.length ? <ChampsVehicule v={v} setV={setV} sites={sites} garage={ctx?.nom || null} /> : <p className="dcl-sub">Aucun garage partenaire n’a encore activé le service.</p>}
          {err && <p className="err">{err}</p>}
          <button className="btn btn-red" disabled={!pret || busy} onClick={async () => {
            if (await post(`${API}/vehicules`, { ...v, garageId: site })) { setV(VEHICULE); flash('Véhicule ajouté'); setEcran('vehicules'); charger() }
          }}>{busy ? 'Enregistrement…' : 'Ajouter ce véhicule'}</button>
          <button className="btn btn-ghost" onClick={() => { setErr(''); setV(VEHICULE); setEcran('vehicules') }}>Retour</button>
        </div>
      </div>, true,
    )
  }

  if (ecran === 'vehicules') {
    return page(
      <div className="dcl-pad rise">
        <h2>Mes véhicules</h2>
        <div className="dcl-stack">
          {vehicules.map(x => (
            <div key={x.id} className="dcl-card dcl-pad">
              <div className="dcl-veh" style={{ margin: 0 }}><Plaque v={x.plaque} /> <b style={{ color: 'var(--ink)' }}>{[x.marque, x.modele].filter(Boolean).join(' ')}</b></div>
              <p className="dcl-sub" style={{ marginTop: 8 }}>Garage : <b style={{ color: 'var(--ink)' }}>{x.garage.nom}</b><br />{x.garage.adresse}</p>
              <p style={{ margin: '8px 0 0', fontSize: 13, fontWeight: 700, color: x.assistance ? '#13704b' : '#8a520a', display: 'flex', gap: 6, alignItems: 'center' }}>{x.assistance ? <><IcoBouclier s={18} />Assistance {x.societe.nom} : pris en charge</> : <><IcoCarte s={18} />Dépannage à régler au chauffeur</>}</p>
              {!x.societe.actif && <p className="err" style={{ marginTop: 6 }}>{x.societe.nom} a suspendu ce service.</p>}
            </div>
          ))}
          <button className="btn btn-red" onClick={() => { setErr(''); setV(VEHICULE); setEcran('ajout') }}>+ Ajouter un véhicule</button>
          <p className="dcl-small">Le garage d’un véhicule ne se change pas dans l’application. Besoin d’un changement ? {tel ? `Appelez-nous au ${tel}.` : 'Appelez-nous.'}</p>
        </div>
      </div>, true,
    )
  }

  if (ecran === 'commande' && !enCours) {
    return page(<Commander vehicules={vehicules.filter(x => x.societe.actif)} onRetour={() => setEcran('accueil')} onEnvoye={() => { flash('Demande envoyée'); setEcran('accueil'); charger() }} />)
  }

  const bonjour = <p className="dcl-veh">Bonjour <b style={{ color: 'var(--ink)' }}>{c.prenom}</b></p>
  const gros = vehicules.some(x => x.societe.actif)
    ? <button className="dcl-big" onClick={() => setEcran('commande')}><img src={IMG.route} alt="" /><div><b>J’ai besoin d’un dépannage</b><span>Localisation et estimation en un geste</span></div></button>
    : <div className="dcl-card dcl-pad" style={{ marginTop: 14 }}><b>Ajoutez d’abord un véhicule</b><p className="dcl-sub">Il sera relié à son garage partenaire.</p><button className="btn btn-red" style={{ marginTop: 10 }} onClick={() => setEcran('ajout')}>+ Ajouter un véhicule</button></div>
  const banniereAjout = proposerAjout ? (
    <div className="dcl-card dcl-pad" style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
      <span style={{ flex: 1, fontSize: 14 }}><b>Un véhicule chez {ctx!.nom} ?</b><br /><span style={{ color: 'var(--ink2)' }}>Ajoutez-le à votre liste.</span></span>
      <button className="btn btn-red" style={{ width: 'auto', minHeight: 44 }} onClick={() => { setV(VEHICULE); setEcran('ajout') }}>Ajouter</button>
    </div>
  ) : null

  if (cmd) {
    const annulee = cmd.suivi.statut === 'annulee'
    const finie = cmd.suivi.statut === 'terminee'
    const vCmd = vehicules.find(x => x.plaque === cmd.plaque)
    return page(
      <div className="dcl-pad rise">
        {bonjour}
        <div className="dcl-card" style={{ marginTop: 14 }}>
          <img src={annulee ? IMG.vide : IMG.succes} alt="" style={{ width: '100%', height: 150, objectFit: 'cover', display: 'block' }} />
          <div className="dcl-pad">
            <div className="dcl-veh" style={{ margin: '0 0 6px' }}><Plaque v={cmd.plaque} /> {cmd.vehicule}</div>
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
        {enCours && <Prevenir />}
        {enCours && cmd.annulable && <Annuler cmd={cmd} deplacement={vCmd?.deplacement ?? null} onFait={m => { flash(m); charger() }} />}
        {enCours && cmd.aSaCharge && <p className="dcl-small">Facture Verviers Dépannage à votre nom, remise après l’intervention.</p>}
        {!enCours && gros}
        {!enCours && banniereAjout}
      </div>, true,
    )
  }

  return page(<div className="dcl-pad rise">{bonjour}{gros}{banniereAjout}</div>, true)
}

function ChampsVehicule({ v, setV, sites, garage }: { v: typeof VEHICULE; setV: (x: typeof VEHICULE) => void; sites: { id: string; nom: string; adresse: string }[]; garage: string | null }) {
  const site = sites.length === 1 ? sites[0].id : v.garageId
  return (
    <>
      <label className="field"><span>Plaque</span><div className="platein"><i>B</i><input value={v.plaque} onChange={e => setV({ ...v, plaque: e.target.value.toUpperCase().replace(/\s/g, '') })} placeholder="1ABC234" /></div></label>
      <div className="dcl-two">
        <label className="field"><span>Marque</span><input className="input" value={v.marque} onChange={e => setV({ ...v, marque: e.target.value })} placeholder="Kia" /></label>
        <label className="field"><span>Modèle</span><input className="input" value={v.modele} onChange={e => setV({ ...v, modele: e.target.value })} placeholder="Ceed" /></label>
      </div>
      <div>
        <h3 style={{ marginTop: 6 }}>Son garage{garage ? ` ${garage}` : ''}</h3>
        <p className="dcl-sub">Celui qui suit ce véhicule. En cas de remorquage, il y est conduit. Il ne se change plus ensuite.</p>
        <div className="dcl-gar" role="radiogroup">
          {sites.map(g => (
            <button key={g.id} type="button" role="radio" aria-checked={site === g.id} className={site === g.id ? 'on' : ''} onClick={() => setV({ ...v, garageId: g.id })}>
              <span className="rd" /><span><b>{g.nom}</b><small>{g.adresse}</small></span>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

/** Sans lien de garage : scanner son QR code, taper son code, ou le choisir dans la liste des partenaires. */
function TrouverGarage({ onGarage, partenaires }: { onGarage: (slug: string) => Promise<string | null>; partenaires: Partenaire[] }) {
  const [scan, setScan] = useState(false)
  const [saisie, setSaisie] = useState(false)
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const lecteur = useRef<any>(null)
  const aller = async (slug: string) => { setErr(''); const e = await onGarage(slug); if (e) setErr(e) }
  const arreter = async () => { try { await lecteur.current?.stop(); lecteur.current?.clear() } catch {} lecteur.current = null; setScan(false) }
  const scanner = async () => {
    setErr(''); setScan(true)
    try {
      const { Html5Qrcode } = await import('html5-qrcode')
      const h = new Html5Qrcode('qr-garage')
      lecteur.current = h
      await h.start({ facingMode: 'environment' }, { fps: 8, qrbox: { width: 230, height: 230 } }, (texte: string) => {
        const s = slugDe(texte)
        arreter()
        if (s) aller(s); else setErr('Ce QR code n’est pas celui d’un garage partenaire.')
      }, () => {})
    } catch { setErr('Caméra indisponible : tapez le code de votre garage.'); setScan(false); setSaisie(true) }
  }
  return (
    <>
      <div style={{ display: scan ? 'block' : 'none', borderRadius: 18, overflow: 'hidden', background: '#000', marginBottom: 12 }}><div id="qr-garage" /></div>
      {scan ? <button className="btn btn-ghost" onClick={arreter}>Arrêter la caméra</button> : (
        <button className="btn btn-red" onClick={scanner}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 12h8" /></svg>
          Scanner le QR code de mon garage
        </button>
      )}
      <p className="dcl-small">Le QR code est sur l’affiche, la facture ou la carte remise par votre garage.</p>
      {saisie ? (
        <div className="dcl-stack rise">
          <label className="field"><span>Code de votre garage</span><input className="input" value={code} onChange={e => setCode(e.target.value)} autoCapitalize="none" autoCorrect="off" placeholder="ex. ebac" /></label>
          <button className="btn btn-ghost" disabled={!slugDe(code)} onClick={() => aller(slugDe(code)!)}>Continuer</button>
        </div>
      ) : <button className="link" style={{ minHeight: 44, display: 'block', margin: '6px auto 0' }} onClick={() => setSaisie(true)}>J’ai un code garage</button>}
      {err && <p className="err" style={{ marginTop: 10, textAlign: 'center' }}>{err}</p>}
      {partenaires.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <h3>Garages partenaires</h3>
          <div className="dcl-gar">
            {partenaires.map(g => (
              <button key={g.slug} type="button" onClick={() => aller(g.slug)}>
                <span className="rd" style={{ borderColor: g.couleur || undefined }} /><span><b>{g.nom}</b><small>Je suis client de ce garage</small></span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function CodeSaisie({ code, setCode, onComplet }: { code: string[]; setCode: (c: string[]) => void; onComplet: (c: string) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  useEffect(() => { refs.current[0]?.focus() }, [])
  const maj = (i: number, val: string) => {
    const chiffres = val.replace(/\D/g, '')
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

function Commander({ vehicules, onRetour, onEnvoye }: { vehicules: Vehicule[]; onRetour: () => void; onEnvoye: () => void }) {
  const [vid, setVid] = useState(vehicules.length === 1 ? vehicules[0].id : '')
  const veh = vehicules.find(x => x.id === vid) || null
  const [pos, setPos] = useState<AdresseChoisie>({ texte: '', lat: null, lng: null })
  // Position demandée seulement quand le client touche « Me localiser » : il ne doit pas se sentir suivi.
  const [gps, setGps] = useState<'attente' | 'cherche' | 'ok' | 'refus'>('attente')
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
  const localiser = () => {
    if (!navigator.geolocation) { setGps('refus'); return }
    setGps('cherche')
    navigator.geolocation.getCurrentPosition(q => { setGps('ok'); adresseDe(q.coords.latitude, q.coords.longitude) }, () => setGps('refus'), { enableHighAccuracy: true, timeout: 15000 })
  }

  // Carte avec un point déplaçable.
  useEffect(() => {
    if (pos.lat == null || pos.lng == null || !carte.current) return
    const pt = { lat: pos.lat, lng: pos.lng }
    loadGoogleMaps(key).then(() => {
      const g = (window as any).google
      if (!gm.current) {
        const map = new g.maps.Map(carte.current, { center: pt, zoom: 16, disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy', clickableIcons: false })
        const marker = new g.maps.Marker({ position: pt, map, draggable: true })
        marker.addListener('dragend', () => { const q = marker.getPosition(); adresseDe(q.lat(), q.lng()) })
        gm.current = { map, marker }
      } else { gm.current.marker.setPosition(pt); gm.current.map.panTo(pt) }
    }).catch(() => {})
  }, [pos.lat, pos.lng, key, adresseDe])

  // Estimations du véhicule choisi (sauf assistance) à chaque nouvelle position.
  useEffect(() => {
    if (!veh || veh.assistance || pos.lat == null || pos.lng == null) return
    setPrix({ dsp: null, rem: null, garage: null, charge: true })
    const t = setTimeout(() => {
      poster(`${API}/estimation`, { vehiculeId: veh.id, lat: pos.lat, lng: pos.lng })
        .then(({ j }) => setPrix({ dsp: j?.dsp ?? null, rem: j?.rem ?? null, garage: j?.garage ?? null, charge: false }))
    }, 400)
    return () => clearTimeout(t)
  }, [pos.lat, pos.lng, veh])

  const pret = !!veh && pos.lat != null && !!panne && (panne !== 'Autre' || !!symptome.trim())
  const envoyer = async () => {
    setBusy(true); setErr('')
    const { ok, j } = await poster(`${API}/commande`, { vehiculeId: vid, adresse: pos.texte, lat: pos.lat, lng: pos.lng, panne, symptome })
    setBusy(false)
    if (!ok) return setErr(j?.error || 'La demande n’a pas pu partir. Appelez-nous.')
    onEnvoye()
  }

  return (
    <div className="dcl-pad rise">
      {vehicules.length > 1 && (
        <>
          <h2 style={{ fontSize: 20 }}>Quel véhicule ?</h2>
          <div className="dcl-gar" role="radiogroup" style={{ marginBottom: 16 }}>
            {vehicules.map(x => (
              <button key={x.id} type="button" role="radio" aria-checked={vid === x.id} className={vid === x.id ? 'on' : ''} onClick={() => setVid(x.id)}>
                <span className="rd" /><span><b>{[x.marque, x.modele].filter(Boolean).join(' ')} · {x.plaque}</b><small>{x.garage.nom}</small></span>
              </button>
            ))}
          </div>
        </>
      )}
      {vehicules.length === 1 && veh && <p className="dcl-veh" style={{ marginBottom: 10 }}><Plaque v={veh.plaque} /> {[veh.marque, veh.modele].filter(Boolean).join(' ')} · {veh.garage.nom}</p>}

      <h2 style={{ fontSize: 20 }}>Où êtes-vous ?</h2>
      {pos.lat == null && (
        <>
          <button className="btn btn-red" style={{ marginTop: 10 }} disabled={gps === 'cherche'} onClick={localiser}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
            {gps === 'cherche' ? 'Localisation…' : 'Me localiser'}
          </button>
          <p className="dcl-small">{gps === 'refus' ? 'Position indisponible : saisissez l’adresse ci-dessous.' : 'Votre position n’est demandée qu’à ce moment-là, pour envoyer le dépanneur au bon endroit.'}</p>
        </>
      )}
      <div className="dcl-map" style={{ display: pos.lat == null ? 'none' : undefined }}><div ref={carte} style={{ position: 'absolute', inset: 0 }} /></div>
      <p className="dcl-sub" style={{ marginTop: 10 }}>{pos.lat != null ? 'Déplacez le point si besoin, ou corrigez l’adresse :' : 'Ou tapez l’adresse de la panne :'}</p>
      <div style={{ marginTop: 6 }}><AdresseInline valeur={pos} onChange={setPos} placeholder="Rue, numéro, localité" /></div>

      <h3 style={{ marginTop: 18 }}>Que se passe-t-il ?</h3>
      <div className="dcl-chips">{PANNES.map(x => <button key={x} className={`dcl-chip ${panne === x ? 'on' : ''}`} onClick={() => setPanne(x)}>{x}</button>)}</div>
      {panne && <input className="input rise" style={{ marginTop: 10 }} value={symptome} onChange={e => setSymptome(e.target.value)} placeholder={panne === 'Autre' ? 'Décrivez les symptômes : bruit, voyant, odeur… (obligatoire)' : 'Un détail utile ? (facultatif)'} />}

      {veh && (veh.assistance ? (
        <div className="dcl-statut ok"><span className="ic"><IcoBouclier c="#13704b" /></span><div><b>Pris en charge par {veh.societe.nom}</b><br /><span style={{ fontSize: 13 }}>Rien à payer.</span></div></div>
      ) : (
        <>
          <div className="dcl-prix">
            <span>Dépannage sur place<small>déplacement et intervention · TVAC · à régler au chauffeur</small></span>
            <b>{prix.charge ? '…' : prix.dsp != null ? `± ${eur(prix.dsp)}` : pos.lat == null ? '—' : 'sur place'}</b>
          </div>
          {(prix.charge || prix.rem != null) && (
            <div className="dcl-prix" style={{ marginTop: 8, background: '#f3ece4', color: 'var(--ink2)' }}>
              <span>Si remorquage jusqu’à {prix.garage || veh.garage.nom}<small>si le véhicule ne peut pas être réparé sur place · TVAC</small></span>
              <b>{prix.charge ? '…' : `± ${eur(prix.rem!)}`}</b>
            </div>
          )}
          <p className="dcl-note">Estimations Verviers Dépannage. C’est le chauffeur qui décide sur place s’il faut remorquer, et il vous confirme le montant avant de charger. Si vous annulez après le départ du dépanneur, ou si vous êtes absent à son arrivée, le déplacement vous est facturé{veh.deplacement ? ` (${eur(veh.deplacement)} TVAC)` : ''}.</p>
        </>
      ))}
      {err && <p className="err" style={{ marginTop: 10 }}>{err}</p>}
      <button className="btn btn-red" style={{ marginTop: 14 }} disabled={!pret || busy} onClick={envoyer}>{busy ? 'Envoi…' : 'Envoyer ma demande'}</button>
      {!pret && <p className="dcl-small">{!veh ? 'Choisissez le véhicule.' : pos.lat == null ? 'Indiquez où vous êtes.' : !panne ? 'Choisissez ce qui se passe.' : 'Décrivez les symptômes.'}</p>}
      <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={onRetour}>Retour</button>
    </div>
  )
}

function Annuler({ cmd, deplacement, onFait }: { cmd: Commande; deplacement: number | null; onFait: (m: string) => void }) {
  const [conf, setConf] = useState(false)
  const [busy, setBusy] = useState(false)
  const frais = cmd.parti && cmd.aSaCharge
  if (!conf) return <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => setConf(true)}>Annuler ma demande{frais && deplacement ? ` (déplacement facturé ${eur(deplacement)})` : ''}</button>
  return (
    <div className="dcl-card dcl-pad rise" style={{ marginTop: 12 }}>
      <b>Annuler votre demande ?</b>
      <p className="dcl-sub" style={{ margin: '4px 0 12px' }}>{frais ? `Le dépanneur est déjà en route : le déplacement vous sera facturé${deplacement ? ` (${eur(deplacement)} TVAC)` : ''}.` : 'Sans frais.'}</p>
      <div className="dcl-two">
        <button className="btn btn-ghost" onClick={() => setConf(false)}>Non, garder</button>
        <button className="btn btn-red" disabled={busy} onClick={async () => {
          setBusy(true)
          const { ok, j } = await poster(`${API}/commande/${cmd.id}/annulation`, {})
          setBusy(false); setConf(false)
          onFait(ok ? j.message : j?.error || 'Annulation impossible. Appelez-nous.')
        }}>{busy ? '…' : 'Oui, annuler'}</button>
      </div>
    </div>
  )
}

// Notifications de suivi (Olivier 10/10/2026) : proposées au moment de la demande, c'est le client qui accepte.
// App iPhone : notifications natives ; navigateur / app installée : web push. Rien si l'appareil ne sait pas.
function Prevenir() {
  const [etat, setEtat] = useState<'?' | 'proposer' | 'ok' | 'refus' | 'busy'>('?')
  const natif = () => (window as any).Capacitor?.Plugins?.PushNotifications
  useEffect(() => {
    let deja = false
    try { deja = localStorage.getItem('vd_assist_notif') === '1' } catch {}
    const web = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    if (deja || (web && Notification.permission === 'granted' && !natif())) { setEtat('ok'); return }
    setEtat(natif() || web ? 'proposer' : 'ok')
  }, [])
  const enregistrer = async (body: any) => {
    const { ok } = await poster(`${API}/push`, body)
    if (ok) { try { localStorage.setItem('vd_assist_notif', '1') } catch {} setEtat('ok') } else setEtat('refus')
  }
  const activer = async () => {
    setEtat('busy')
    try {
      const P = natif()
      if (P) {
        // Jamais « await » sur le plugin lui-même : seulement sur ses méthodes.
        P.addListener('registration', (t: any) => enregistrer({ kind: 'apns', token: t?.value }))
        P.addListener('registrationError', () => setEtat('refus'))
        const perm = await P.requestPermissions()
        if (perm?.receive !== 'granted') { setEtat('refus'); return }
        await P.register()
        return
      }
      if (await Notification.requestPermission() !== 'granted') { setEtat('refus'); return }
      const reg = await navigator.serviceWorker.ready
      const k = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''
      const raw = Uint8Array.from(atob((k + '='.repeat((4 - k.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw })
      await enregistrer({ kind: 'web', subscription: sub.toJSON() })
    } catch { setEtat('refus') }
  }
  if (etat === '?' || etat === 'ok') return null
  return (
    <div className="dcl-card dcl-pad" style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
      <Pastille fond="#fff1ef"><IcoCloche c="#d42a2a" /></Pastille>
      <span style={{ flex: 1, fontSize: 14 }}>
        <b>Être prévenu</b><br />
        <span style={{ color: 'var(--ink2)' }}>{etat === 'refus' ? 'Notifications refusées : activez-les dans les réglages du téléphone, ou suivez ici.' : 'Une notification quand le chauffeur part et quand il arrive.'}</span>
      </span>
      {etat !== 'refus' && <button className="btn btn-red" style={{ width: 'auto', minHeight: 44 }} disabled={etat === 'busy'} onClick={activer}>{etat === 'busy' ? '…' : 'Me prévenir'}</button>}
    </div>
  )
}
