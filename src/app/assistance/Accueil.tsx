'use client'
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from 'react'
import { IMG } from '../espace/_ui/suivi'

export const GARAGE_MEMO = 'vd_assistance_garage'
const slugDe = (texte: string): string | null => {
  const t = texte.trim()
  const m = t.match(/\/d\/([a-z0-9-]+)/i)
  if (m) return m[1].toLowerCase()
  return /^[a-z0-9-]{2,40}$/i.test(t) ? t.toLowerCase() : null
}

export default function Accueil({ garages }: { garages: { nom: string; slug: string; couleur: string | null }[] }) {
  const [pret, setPret] = useState(false)
  const [scan, setScan] = useState(false)
  const [code, setCode] = useState('')
  const [saisie, setSaisie] = useState(false)
  const [err, setErr] = useState('')
  const lecteur = useRef<any>(null)

  // Garage déjà choisi : on y va directement (sauf demande explicite de changer).
  useEffect(() => {
    const changer = new URLSearchParams(location.search).has('changer')
    let memo = ''
    try { memo = localStorage.getItem(GARAGE_MEMO) || '' } catch {}
    if (memo && !changer) { location.replace(`/d/${memo}`); return }
    setPret(true)
  }, [])

  const aller = async (slug: string) => {
    setErr('')
    const r = await fetch(`/api/d/${slug}`, { cache: 'no-store' }).catch(() => null)
    if (!r?.ok) { setErr('Ce code ne correspond à aucun garage partenaire.'); return }
    location.href = `/d/${slug}`
  }
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

  if (!pret) return <div className="dcl-app" />
  return (
    <div className="dcl-app">
      <header className="dcl-co">
        <span className="lg"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17h2m12 0h4v-4l-3-4h-5v8M3 17V7h10v10" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /></svg></span>
        <div><small>Verviers Dépannage</small><b>VD Assistance</b></div>
      </header>
      <div className="dcl-hero"><img src={IMG.nuit} alt="" /><div><h1>En panne ? On arrive.</h1><p>Le dépannage de votre garage partenaire, 24 h/24. Rejoignez votre garage une seule fois, commandez en 30 secondes.</p></div></div>
      <div className="dcl-pad">
        <div style={{ display: scan ? 'block' : 'none', borderRadius: 18, overflow: 'hidden', background: '#000', marginBottom: 12 }}><div id="qr-garage" /></div>
        {scan ? (
          <button className="btn btn-ghost" onClick={arreter}>Arrêter la caméra</button>
        ) : (
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
        ) : (
          <button className="link" style={{ minHeight: 44, display: 'block', margin: '6px auto 0' }} onClick={() => setSaisie(true)}>J’ai un code garage</button>
        )}
        {err && <p className="err" style={{ marginTop: 10, textAlign: 'center' }}>{err}</p>}

        {garages.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <h3>Garages partenaires</h3>
            <div className="dcl-gar">
              {garages.map(g => (
                <button key={g.slug} type="button" onClick={() => aller(g.slug)}>
                  <span className="rd" style={{ borderColor: g.couleur || undefined }} /><span><b>{g.nom}</b><small>Je suis client de ce garage</small></span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <footer className="dcl-foot"><a href="/assistance/confidentialite">Confidentialité</a></footer>
    </div>
  )
}
