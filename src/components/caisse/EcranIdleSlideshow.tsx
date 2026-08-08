'use client'

// Diaporama « au repos » de l'écran comptoir (plein écran). Défile en boucle
// tant qu'aucune fiche ne pousse un paiement / une lecture eID / une visite.
// Tailles en vw/vh → remplit l'écran. Olivier 2026-08-08.

import { useEffect, useState } from 'react'

const N = 5
const INTERVAL = 7000

export default function EcranIdleSlideshow() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => setI(p => (p + 1) % N), INTERVAL)
    return () => clearInterval(iv)
  }, [])

  return (
    <div className="vd-ecran-pub" style={{ position: 'fixed', inset: 0, background: '#fff', overflow: 'hidden' }}>
      <style>{CSS}</style>

      {/* 1 · HERO */}
      <section className={`sl hero ${i === 0 ? 'on' : ''}`}>
        <img className="logo" src="/logo.jpg" alt="Verviers Dépannage" />
        <div className="h">Dépannage &amp; Remorquage</div>
        <div className="tagline">Assistance 24 h/24 · 7 j/7 — toutes marques, toutes assurances</div>
        <div className="phone">087 / 35.18.20&nbsp;&nbsp;·&nbsp;&nbsp;verviersdepannage.com</div>
      </section>

      {/* 2 · PAIEMENT */}
      <section className={`sl ${i === 1 ? 'on' : ''}`}>
        <div className="top"><img className="topLogo" src="/logo.jpg" alt="" /></div>
        <div className="kick">Paiement</div>
        <div className="h">Simple &amp; rapide</div>
        <div className="rule" />
        <div className="pays">
          <div className="pay">
            <svg viewBox="0 0 46 26" style={{ height: '3vw' }}><polygon points="4,2 24,2 17,12 -3,12" fill="#FFDD00" /><polygon points="13,14 33,14 26,24 6,24" fill="#004E9E" /></svg>
            <span className="bctxt">Bancontact</span>
          </div>
          <div className="pay"><span className="visa">VISA</span></div>
          <div className="pay"><svg viewBox="0 0 48 30" style={{ height: '4.4vw' }}><circle cx="18" cy="15" r="12" fill="#EB001B" /><circle cx="30" cy="15" r="12" fill="#F79E1B" /><path d="M24 6a12 12 0 000 18 12 12 0 000-18z" fill="#FF5F00" /></svg></div>
          <div className="pay"><svg viewBox="0 0 48 30" style={{ height: '4.4vw' }}><circle cx="18" cy="15" r="12" fill="#0099DF" /><circle cx="30" cy="15" r="12" fill="#ED0006" /><path d="M24 6a12 12 0 000 18 12 12 0 000-18z" fill="#6C6BBD" /></svg></div>
          <div className="pay"><svg viewBox="0 0 24 24" style={{ height: '3.4vw' }}><path fill="#000" d="M17.05 12.04c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.09-2.01-3.76-2.04-1.6-.16-3.12.94-3.93.94-.81 0-2.06-.92-3.39-.89-1.74.03-3.35 1.01-4.25 2.57-1.81 3.14-.46 7.79 1.3 10.34.86 1.25 1.88 2.65 3.22 2.6 1.29-.05 1.78-.83 3.34-.83 1.56 0 2 .83 3.37.81 1.39-.02 2.27-1.27 3.12-2.53.98-1.45 1.39-2.85 1.41-2.92-.03-.01-2.71-1.04-2.74-4.14zM14.6 4.6c.71-.86 1.19-2.06 1.06-3.25-1.02.04-2.26.68-2.99 1.54-.66.76-1.23 1.98-1.08 3.15 1.14.09 2.3-.58 3.01-1.44z" /></svg><span className="paylbl">Pay</span></div>
          <div className="pay"><svg viewBox="0 0 24 24" style={{ height: '3.4vw' }}><path fill="#4285F4" d="M23 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h6.2a5.3 5.3 0 01-2.3 3.5v2.9h3.7c2.2-2 3.4-5 3.4-8.4z" /><path fill="#34A853" d="M12 24c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3C3.7 21.3 7.5 24 12 24z" /><path fill="#FBBC05" d="M5.6 14.7a7.2 7.2 0 010-4.6V7.1H1.8a12 12 0 000 10.8l3.8-3z" /><path fill="#EA4335" d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.7 1.3 15.1.3 12 .3 7.5.3 3.7 3 1.8 7.1l3.8 3C6.5 7 9 4.8 12 4.8z" /></svg><span className="paylbl" style={{ color: '#5f6368' }}>Pay</span></div>
        </div>
      </section>

      {/* 3 · VR — DOCUMENTS + CAUTION */}
      <section className={`sl ${i === 2 ? 'on' : ''}`}>
        <div className="top"><img className="topLogo" src="/logo.jpg" alt="" /><span className="sec">Véhicule de remplacement</span></div>
        <div className="kick">Pour obtenir un véhicule de remplacement</div>
        <div className="h">Présentez-vous avec vos documents</div>
        <div className="rule" style={{ marginBottom: '3.4vh' }} />
        <div className="cards">
          <div className="card">
            <div className="ib red"><svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="2" /><circle cx="8" cy="11" r="2.1" /><path d="M4.8 16.2c.7-1.7 5.7-1.7 6.4 0" /><path d="M14.5 9.5h4.5M14.5 12.5h4.5M14.5 15.5h3" /></svg></div>
            <div className="n">Carte d'identité</div><div className="d">En cours de validité</div>
          </div>
          <div className="card">
            <div className="ib red"><svg viewBox="0 0 24 24"><path d="M3.5 13l1.8-4.7A2 2 0 017.2 7h9.6a2 2 0 011.9 1.3L20.5 13" /><path d="M2.6 13h18.8v3.6a1 1 0 01-1 1h-2v-1.8H5.6v1.8h-2a1 1 0 01-1-1z" /><circle cx="7" cy="15.6" r="1.2" /><circle cx="17" cy="15.6" r="1.2" /></svg></div>
            <div className="n">Permis de conduire</div><div className="d">Original</div>
          </div>
          <div className="card">
            <div className="ib red"><svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2.4" /><path d="M9.5 5.5h5" /></svg></div>
            <div className="n">Application itsme</div><div className="d">Installée &amp; activée</div>
          </div>
        </div>
        <div className="vrcaution">
          <div className="ib red"><svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="2" /><line x1="2.5" y1="9.5" x2="21.5" y2="9.5" /><line x1="6" y1="15" x2="10.5" y2="15" /></svg></div>
          <div className="ct"><b>Caution éventuelle selon l'assistance</b> — uniquement par carte de crédit, <b>jamais en espèces</b>. Sans carte de crédit : pas de véhicule de remplacement.</div>
        </div>
      </section>

      {/* 4 · VR — RESTITUTION */}
      <section className={`sl ${i === 3 ? 'on' : ''}`}>
        <div className="top"><img className="topLogo" src="/logo.jpg" alt="" /><span className="sec">Véhicule de remplacement</span></div>
        <div className="kick">À la restitution</div>
        <div className="h">Rendez-le comme vous l'avez reçu</div>
        <div className="rule" />
        <div className="rules">
          <div className="r">
            <div className="ib red"><svg viewBox="0 0 24 24"><path d="M12 3.5l1.7 4.6L18.3 10l-4.6 1.9L12 16.5l-1.7-4.6L5.7 10l4.6-1.9z" /><circle cx="18.5" cy="16.5" r="1.1" /><circle cx="6" cy="16" r=".9" /></svg></div>
            <div><div className="n">Propre</div><div className="d">Intérieur &amp; extérieur</div></div>
          </div>
          <div className="r">
            <div className="ib red"><svg viewBox="0 0 24 24"><rect x="4" y="3.5" width="9" height="17" rx="1.6" /><line x1="4" y1="9" x2="13" y2="9" /><path d="M13 7.5l3 2v6.5a2 2 0 004 0V11l-2-2" /></svg></div>
            <div><div className="n">Même niveau de carburant</div><div className="d">Qu'au moment de la remise</div></div>
          </div>
        </div>
      </section>

      {/* 5 · SÉCURITÉ */}
      <section className={`sl navy ${i === 4 ? 'on' : ''}`}>
        <div className="top"><img className="topLogo" src="/logo.jpg" alt="" /><span className="sec">Sécurité</span></div>
        <div className="kick">Accès au parc</div>
        <div className="h">Accès aux véhicules après identification</div>
        <div className="rule" />
        <div className="lead">Pour la sécurité de tous et la traçabilité, l'accès aux véhicules du parc se fait <b>uniquement après présentation et lecture de votre carte d'identité</b>.</div>
        <div className="chipline"><div className="ib red sm"><svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="2" /><circle cx="8" cy="11" r="2" /><path d="M4.8 16c.7-1.6 5.5-1.6 6.2 0" /><path d="M14.5 10h4.5M14.5 13h3.5" /></svg></div>Carte d'identité obligatoire</div>
        <div className="watermark"><svg viewBox="0 0 24 24"><path d="M12 2l8 3.4v5.6c0 5.2-3.4 8.6-8 10.4-4.6-1.8-8-5.2-8-10.4V5.4z" /><path d="M8.5 12l2.4 2.4L16 9.5" /></svg></div>
      </section>

      {/* points */}
      <div className="dots">{Array.from({ length: N }).map((_, k) => <span key={k} className={`dot ${k === i ? 'on' : ''}`} />)}</div>
    </div>
  )
}

const CSS = `
.vd-ecran-pub{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,Arial,sans-serif;color:#101828}
.vd-ecran-pub .sl{position:absolute;inset:0;opacity:0;transition:opacity .8s ease;
  display:flex;flex-direction:column;justify-content:flex-start;padding:17vh 8vw 6vh;pointer-events:none}
.vd-ecran-pub .sl.on{opacity:1}
.vd-ecran-pub .hero{padding:0 8vw;justify-content:center}
.vd-ecran-pub .top{position:absolute;top:6vh;left:8vw;right:8vw;display:flex;align-items:center;justify-content:space-between;z-index:2}
.vd-ecran-pub .topLogo{height:6.5vh;width:auto;object-fit:contain;display:block}
.vd-ecran-pub .sec{font-size:1.35vw;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:#475069}
.vd-ecran-pub .kick{font-size:1.5vw;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#CC2222;margin-bottom:1.6vh}
.vd-ecran-pub .h{font-weight:800;letter-spacing:-.02em;line-height:1.04;font-size:4.2vw;text-wrap:balance}
.vd-ecran-pub .rule{width:9vw;height:.6vh;background:#CC2222;border-radius:9px;margin-top:2.4vh;margin-bottom:4vh}
.vd-ecran-pub svg{display:block}

.vd-ecran-pub .hero{align-items:center;text-align:center}
.vd-ecran-pub .hero .logo{height:26vh;width:auto;object-fit:contain;margin-bottom:5vh}
.vd-ecran-pub .hero .h{font-size:6vw}
.vd-ecran-pub .hero .tagline{margin-top:3.5vh;font-size:2.2vw;font-weight:600;color:#475069}
.vd-ecran-pub .hero .phone{margin-top:2vh;font-weight:800;font-size:2.4vw}

.vd-ecran-pub .ib{width:7vw;height:7vw;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:none}
.vd-ecran-pub .ib svg{width:3.6vw;height:3.6vw;stroke-width:1.7;fill:none;stroke-linecap:round;stroke-linejoin:round}
.vd-ecran-pub .ib.red{background:#fdecec}.vd-ecran-pub .ib.red svg{stroke:#CC2222}
.vd-ecran-pub .ib.wht{background:rgba(255,255,255,.16)}.vd-ecran-pub .ib.wht svg{stroke:#fff}
.vd-ecran-pub .ib.sm{width:4vw;height:4vw}.vd-ecran-pub .ib.sm svg{width:2.2vw;height:2.2vw}

.vd-ecran-pub .pays{display:grid;grid-template-columns:repeat(3,1fr);gap:2vw;width:100%}
.vd-ecran-pub .pay{background:#fff;border:1px solid #e6e9f0;border-radius:18px;height:22vh;display:flex;align-items:center;justify-content:center;gap:1vw;box-shadow:0 10px 26px rgba(16,24,40,.06)}
.vd-ecran-pub .visa{color:#1a1f71;font-style:italic;font-weight:800;font-size:3.4vw;letter-spacing:.04em}
.vd-ecran-pub .bctxt{color:#004E9E;font-weight:800;font-size:2.5vw;letter-spacing:-.02em}
.vd-ecran-pub .paylbl{font-weight:600;font-size:2.5vw}

.vd-ecran-pub .cards,.vd-ecran-pub .rules{display:grid;gap:2.2vw;width:100%}
.vd-ecran-pub .cards{grid-template-columns:repeat(3,1fr)}
.vd-ecran-pub .rules{grid-template-columns:1fr 1fr}
.vd-ecran-pub .card{background:#f4f6f9;border:1px solid #e6e9f0;border-radius:20px;padding:2.6vh 2vw;display:flex;flex-direction:column;align-items:center;text-align:center;gap:1.2vh}
.vd-ecran-pub .card .ib{width:5.4vw;height:5.4vw}.vd-ecran-pub .card .ib svg{width:2.9vw;height:2.9vw}
.vd-ecran-pub .card .n{font-weight:800;font-size:2.1vw}.vd-ecran-pub .card .d{font-size:1.5vw;color:#475069}
.vd-ecran-pub .vrcaution{margin-top:3.4vh;display:flex;gap:1.6vw;align-items:center;background:#fdecec;border:1px solid #f4caca;border-radius:16px;padding:2.4vh 2vw}
.vd-ecran-pub .vrcaution .ib{width:5vw;height:5vw}.vd-ecran-pub .vrcaution .ib svg{width:2.6vw;height:2.6vw}
.vd-ecran-pub .vrcaution .ct{font-size:1.7vw;color:#101828;line-height:1.4}
.vd-ecran-pub .vrcaution b{color:#CC2222}
.vd-ecran-pub .r{background:#f4f6f9;border:1px solid #e6e9f0;border-radius:22px;padding:4.5vh 2.4vw;display:flex;align-items:center;gap:2vw}
.vd-ecran-pub .r .n{font-weight:800;font-size:2.4vw}.vd-ecran-pub .r .d{font-size:1.5vw;color:#475069}

.vd-ecran-pub .red-bg{background:radial-gradient(130% 130% at 12% -10%,#CC2222,#9f1319 78%);color:#fff}
.vd-ecran-pub .red-bg .kick{color:rgba(255,255,255,.82)}
.vd-ecran-pub .red-bg .sec{color:rgba(255,255,255,.85)}
.vd-ecran-pub .logo-chip{background:#fff;padding:1.2vh 1vw;border-radius:12px;display:inline-flex}
.vd-ecran-pub .logo-chip img{height:7vh;display:block}
.vd-ecran-pub .warn{display:flex;gap:2vw;align-items:center;background:rgba(255,255,255,.11);border:1px solid rgba(255,255,255,.26);border-radius:18px;padding:4vh 2.4vw;max-width:90%}
.vd-ecran-pub .warn .t{font-size:2.1vw;font-weight:600;line-height:1.4}
.vd-ecran-pub .no{margin-top:3vh;display:flex;gap:1.4vw;align-items:center;font-weight:800;font-size:2.3vw}

.vd-ecran-pub .navy{background:#fff;color:#101828}
.vd-ecran-pub .navy .kick{color:#CC2222}.vd-ecran-pub .navy .sec{color:#475069}
.vd-ecran-pub .navy .lead{font-size:2.1vw;color:#475069;line-height:1.45;max-width:78%}
.vd-ecran-pub .navy .chipline{margin-top:3.2vh;display:inline-flex;gap:1.4vw;align-items:center;background:#fdecec;border:1px solid #f4caca;border-radius:16px;padding:2vh 1.8vw;font-weight:800;font-size:2vw}
.vd-ecran-pub .navy .watermark{position:absolute;right:4vw;bottom:-4vh;opacity:.05;z-index:0}
.vd-ecran-pub .navy .watermark svg{width:42vh;height:42vh;stroke:#101828;stroke-width:1;fill:none}
.vd-ecran-pub .navy .top,.vd-ecran-pub .navy .kick,.vd-ecran-pub .navy .h,.vd-ecran-pub .navy .rule,.vd-ecran-pub .navy .lead,.vd-ecran-pub .navy .chipline{position:relative;z-index:1}

.vd-ecran-pub .dots{position:absolute;bottom:4vh;left:0;right:0;display:flex;gap:1vw;justify-content:center;z-index:5}
.vd-ecran-pub .dot{width:1vw;height:1vw;border-radius:50%;background:rgba(120,128,145,.4);transition:all .35s}
.vd-ecran-pub .dot.on{background:#CC2222;width:3vw;border-radius:99px}
`
