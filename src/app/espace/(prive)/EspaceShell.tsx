'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, useContext, useEffect, useState } from 'react'
import { Marque, IcoPlus } from '../_ui/suivi'

export interface CompteEspace { id: string; nom: string; email: string; role: 'societe' | 'gestionnaire' | 'collaborateur'; peutInviter: boolean; aMotDePasse: boolean; mesClients: boolean }
export interface GarageEspace { nom: string; adresse: string; lat: number | null; lng: number | null }
export interface SocieteEspace { id: string; nom: string; couleur: string | null; garages: GarageEspace[] }
const Ctx = createContext<{ compte: CompteEspace; societes: SocieteEspace[] } | null>(null)
export const useEspace = () => useContext(Ctx)!

export default function EspaceShell({ compte, societes, children }: { compte: CompteEspace; societes: SocieteEspace[]; children: React.ReactNode }) {
  const path = usePathname()
  const [menu, setMenu] = useState(false)
  const [mdp, setMdp] = useState(false)
  const onglets = [
    { href: '/espace', label: 'Mes interventions', court: 'Suivi' },
    { href: '/espace/nouvelle', label: 'Commander', court: 'Commander' },
    ...(compte.mesClients ? [{ href: '/espace/clients', label: 'Mes clients', court: 'Clients' }] : []),
    ...(compte.peutInviter ? [{ href: '/espace/equipe', label: 'Mon équipe', court: 'Équipe' }] : []),
  ]
  const initiales = compte.nom.split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase()
  return (
    <Ctx.Provider value={{ compte, societes }}>
      <header className="top">
        <div className="wrap">
          <Link href="/espace"><Marque /></Link>
          <nav className="nav">{onglets.map(o => <Link key={o.href} href={o.href} className={path === o.href ? 'on' : ''}>{o.label}</Link>)}</nav>
          <div style={{ position: 'relative', marginLeft: 'auto' }}>
            <button className="who" onClick={() => setMenu(v => !v)} aria-label="Mon compte">
              <span className="avatar">{initiales}</span>
              <span className="t"><b>{compte.nom}</b><span>{societes.map(s => s.nom).join(' · ')}</span></span>
            </button>
            {menu && (
              <div className="card" style={{ position: 'absolute', right: 0, top: 54, width: 270, overflow: 'hidden', animation: 'pop .3s', zIndex: 50 }}>
                <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--mute)', borderBottom: '1px solid var(--line)' }}>Connecté avec <b style={{ color: 'var(--ink)' }}>{compte.email}</b></div>
                <button style={{ display: 'block', width: '100%', textAlign: 'left', padding: '13px 16px', fontWeight: 700, minHeight: 46 }} onClick={() => { setMenu(false); setMdp(true) }}>{compte.aMotDePasse ? 'Changer mon mot de passe' : 'Choisir un mot de passe'}</button>
                <button style={{ display: 'block', width: '100%', textAlign: 'left', padding: '13px 16px', fontWeight: 700, color: 'var(--red)', minHeight: 46 }} onClick={async () => { await fetch('/api/espace/connexion', { method: 'DELETE' }); location.href = '/espace/connexion' }}>Se déconnecter</button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main><Installer />{children}</main>
      <nav className="tabbar">
        {onglets.map(o => (
          <Link key={o.href} href={o.href} className={path === o.href ? 'on' : ''}>
              {o.href === '/espace/nouvelle' ? <span className="plus"><IcoPlus s={20} /></span>
                : o.href === '/espace/clients' ? <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" /></svg>
                : o.href === '/espace/equipe' ? <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.8-3 3-4.6 5.5-4.6s4.7 1.6 5.5 4.6M16 11.5a2.8 2.8 0 1 0-1-5.4M17.5 14.6c1.6.5 2.6 1.9 3 4.4" /></svg>
                  : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16M4 12h10M4 19h7" /><circle cx="18" cy="16" r="3" /></svg>}
              <span>{o.court}</span>
          </Link>
        ))}
      </nav>
      {mdp && <MotDePasse onClose={() => setMdp(false)} />}
    </Ctx.Provider>
  )
}

function MotDePasse({ onClose }: { onClose: () => void }) {
  const [v, setV] = useState(''), [v2, setV2] = useState(''), [err, setErr] = useState(''), [ok, setOk] = useState(false), [busy, setBusy] = useState(false)
  const router = useRouter()
  const go = async () => {
    setErr('')
    if (v.length < 8) return setErr('Au moins 8 caractères.')
    if (v !== v2) return setErr('Les deux mots de passe ne sont pas identiques.')
    setBusy(true)
    const r = await fetch('/api/espace/moi', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motDePasse: v }) })
    setBusy(false)
    if (!r.ok) return setErr((await r.json().catch(() => ({}))).error || 'Erreur')
    setOk(true); router.refresh()
  }
  return (
    <div className="modal">
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}><h2 style={{ fontSize: 20 }}>Mot de passe</h2><button className="x" style={{ background: 'var(--soft)', color: 'var(--ink)' }} onClick={onClose} aria-label="Fermer">✕</button></div>
        {ok ? (
          <><p style={{ color: 'var(--ink2)' }}>C’est enregistré. Vous pourrez vous connecter avec ce mot de passe, ou recevoir un code par mail.</p><button className="btn btn-red" style={{ width: '100%' }} onClick={onClose}>Fermer</button></>
        ) : (
          <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
            <input type="password" className="input" placeholder="Nouveau mot de passe" value={v} onChange={e => setV(e.target.value)} autoComplete="new-password" />
            <input type="password" className="input" placeholder="Confirmer" value={v2} onChange={e => setV2(e.target.value)} autoComplete="new-password" />
            {err && <p className="err">{err}</p>}
            <button className="btn btn-red" disabled={busy} onClick={go}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        )}
      </div>
    </div>
  )
}

// Bandeau « Installer VD Espace pro » (Olivier 20/10/2026) : icône sur l'écran d'accueil, sans passer par un store.
// Android et ordinateur : bouton (beforeinstallprompt) ; iPhone : le geste Partager → « Sur l'écran d'accueil ».
// Caché quand l'espace tourne déjà en app installée, ou après « Plus tard » sur cet appareil.
function Installer() {
  const [evt, setEvt] = useState<any>(null)
  const [ios, setIos] = useState(false)
  const [vu, setVu] = useState(true)
  useEffect(() => {
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true
    let ferme = false
    try { ferme = localStorage.getItem('vd_espace_install_ferme') === '1' } catch {}
    if (standalone || ferme) return
    const ua = navigator.userAgent
    if (/iPhone|iPad|iPod/.test(ua) && !/CriOS|FxiOS/.test(ua)) { setIos(true); setVu(false) }
    const h = (e: any) => { e.preventDefault(); setEvt(e); setVu(false) }
    window.addEventListener('beforeinstallprompt', h)
    return () => window.removeEventListener('beforeinstallprompt', h)
  }, [])
  if (vu || (!evt && !ios)) return null
  const fermer = () => { try { localStorage.setItem('vd_espace_install_ferme', '1') } catch {} setVu(true) }
  return (
    <div className="wrap" style={{ marginTop: 14 }}>
      <div className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <img src="/icons/icon-96x96.png" alt="" width={44} height={44} style={{ borderRadius: 10 }} />
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <b>Installer VD Espace pro</b>
          <div style={{ fontSize: 13, color: 'var(--ink2)' }}>
            {ios ? <>Touchez <b>Partager</b> en bas de Safari, puis <b>« Sur l’écran d’accueil »</b> : votre espace s’ouvre ensuite d’un geste, comme une app.</>
              : <>Une icône sur votre écran d’accueil ou votre bureau : votre espace s’ouvre d’un geste, comme une app.</>}
          </div>
        </div>
        {evt && <button className="btn btn-red" style={{ minHeight: 44 }} onClick={async () => { evt.prompt(); await evt.userChoice.catch(() => null); setEvt(null); setVu(true) }}>Installer</button>}
        <button className="btn btn-ghost" style={{ minHeight: 44 }} onClick={fermer}>Plus tard</button>
      </div>
    </div>
  )
}
