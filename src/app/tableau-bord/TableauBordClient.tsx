'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

// Mur d'écran ops — page publique protégée par PIN. Rafraîchissement auto +
// slides auto-rotatives. Olivier 2026-07-30.

interface Kpi {
  at: string
  ops: { enCommande: number; enAttente: number; enCours: number; aFacturer: number; enParc: number; enParcKK1: number; cloturesJour: number }
  facturation: { periodeJours: number; total: number; dureeMoyMin: number | null; parUser: { user: string; count: number; pct: number; system: boolean }[] }
}

const POLL_MS   = 10_000
const DEFAULT_ROTATE_S = 12
const SLIDES = 2

const fmtDuree = (min: number | null) => {
  if (min == null) return '—'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60), m = min % 60
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
}
const two = (n: number) => String(n).padStart(2, '0')

export default function TableauBordClient() {
  const [pin, setPin]       = useState('')
  const [authed, setAuthed] = useState(false)
  const [pinErr, setPinErr] = useState(false)
  const [data, setData]     = useState<Kpi | null>(null)
  const [stale, setStale]   = useState(false)
  const [slide, setSlide]   = useState(0)
  const [progress, setProgress] = useState(0)
  const [clock, setClock]   = useState('')
  const savedPin = useRef('')
  const rotateS  = useRef(DEFAULT_ROTATE_S)

  // Horloge.
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date()
      setClock(`${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`)
    }, 1000)
    return () => clearInterval(t)
  }, [])

  // Restaure le PIN (session) + lit ?rotate=.
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search)
      const r = parseInt(sp.get('rotate') || '')
      if (r >= 3 && r <= 120) rotateS.current = r
      const p = sessionStorage.getItem('tb_pin')
      if (p) { savedPin.current = p; setAuthed(true) }
    } catch {}
  }, [])

  const fetchData = useCallback(async () => {
    const p = savedPin.current
    if (!p) return
    try {
      const r = await fetch('/api/tableau-bord', { headers: { 'x-dashboard-pin': p }, cache: 'no-store' })
      if (r.status === 401) { setAuthed(false); savedPin.current = ''; try { sessionStorage.removeItem('tb_pin') } catch {}; return }
      const j = await r.json()
      if (j?.ok) { setData(j); setStale(false) }
    } catch { setStale(true) }
  }, [])

  // Polling.
  useEffect(() => {
    if (!authed) return
    fetchData()
    const t = setInterval(fetchData, POLL_MS)
    const s = setInterval(() => setStale(true), POLL_MS * 3)   // pas de MAJ depuis 30s → indicateur
    return () => { clearInterval(t); clearInterval(s) }
  }, [authed, fetchData])

  // Rotation des slides + barre de progression.
  useEffect(() => {
    if (!authed) return
    let p = 0
    const step = 100 / (rotateS.current * 10)
    const t = setInterval(() => {
      p += step
      if (p >= 100) { p = 0; setSlide(s => (s + 1) % SLIDES) }
      setProgress(p)
    }, 100)
    return () => clearInterval(t)
  }, [authed])

  // Saisie PIN.
  const press = (d: string) => {
    setPinErr(false)
    setPin(prev => {
      const next = (prev + d).slice(0, 6)
      if (next.length === 6) void submit(next)
      return next
    })
  }
  const submit = async (code: string) => {
    try {
      const r = await fetch('/api/tableau-bord', { headers: { 'x-dashboard-pin': code }, cache: 'no-store' })
      if (r.ok) {
        savedPin.current = code
        try { sessionStorage.setItem('tb_pin', code) } catch {}
        setAuthed(true); setPin('')
      } else { setPinErr(true); setPin('') }
    } catch { setPinErr(true); setPin('') }
  }

  if (!authed) {
    return (
      <div className="tb-root tb-center">
        <div className="tb-pinbox">
          <div className="tb-pintitle">VD Soft — Tableau de bord</div>
          <div className="tb-pinsub">Code d'accès</div>
          <div className={`tb-dots ${pinErr ? 'tb-shake' : ''}`}>
            {[0, 1, 2, 3, 4, 5].map(i => <span key={i} className={`tb-dot ${i < pin.length ? 'on' : ''}`} />)}
          </div>
          {pinErr && <div className="tb-pinerr">Code incorrect</div>}
          <div className="tb-pad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
              <button key={d} className="tb-key" onClick={() => press(d)}>{d}</button>
            ))}
            <button className="tb-key tb-key-sm" onClick={() => { setPin(''); setPinErr(false) }}>C</button>
            <button className="tb-key" onClick={() => press('0')}>0</button>
            <button className="tb-key tb-key-sm" onClick={() => setPin(p => p.slice(0, -1))}>⌫</button>
          </div>
        </div>
        <style>{CSS}</style>
      </div>
    )
  }

  const ops = data?.ops
  const fac = data?.facturation

  return (
    <div className="tb-root">
      <header className="tb-head">
        <div className="tb-brand">VD&nbsp;Soft <span className="tb-brand-sub">· Tableau de bord opérations</span></div>
        <div className="tb-headright">
          <span className={`tb-live ${stale ? 'off' : ''}`}>● {stale ? 'reconnexion…' : 'en direct'}</span>
          <span className="tb-clock">{clock}</span>
        </div>
      </header>

      <main className="tb-main">
        {/* SLIDE 1 — compteurs ops */}
        <section className={`tb-slide ${slide === 0 ? 'show' : ''}`}>
          <div className="tb-grid6">
            <Tile label="En commande"  value={ops?.enCommande} color="#a78bfa" hint="commandes reçues" />
            <Tile label="En attente"   value={ops?.enAttente}  color="#fbbf24" hint="à attribuer / au départ" />
            <Tile label="En cours"     value={ops?.enCours}    color="#38bdf8" hint="chauffeur en intervention" />
            <Tile label="À facturer"   value={ops?.aFacturer}  color="#fb923c" hint="en attente facturation" />
            <Tile label="Véhicules en parc" value={ops?.enParc} color="#34d399" hint="présents en fourrière"
              sub={ops ? `K + K1 : ${ops.enParcKK1}` : undefined} />
            <Tile label="Clôturés aujourd'hui" value={ops?.cloturesJour} color="#4ade80" hint="dossiers terminés du jour" />
          </div>
        </section>

        {/* SLIDE 2 — facturation */}
        <section className={`tb-slide ${slide === 1 ? 'show' : ''}`}>
          <div className="tb-fac">
            <div className="tb-facleft">
              <div className="tb-facttl">Répartition de la facturation par personne <span>· 30 derniers jours</span></div>
              <div className="tb-bars">
                {(fac?.parUser || []).slice(0, 8).map((u, i) => (
                  <div className="tb-barrow" key={i}>
                    <div className="tb-barname" style={{ opacity: u.system ? 0.7 : 1 }}>{u.user}</div>
                    <div className="tb-bartrack">
                      <div className="tb-barfill" style={{ width: `${u.pct}%`, background: u.system ? '#64748b' : BAR_COLORS[i % BAR_COLORS.length] }} />
                    </div>
                    <div className="tb-barpct">{u.pct}%<span className="tb-barcount"> · {u.count}</span></div>
                  </div>
                ))}
                {!fac?.parUser?.length && <div className="tb-empty">Aucune facturation sur la période.</div>}
              </div>
            </div>
            <div className="tb-facright">
              <div className="tb-bigstat">
                <div className="tb-bigval" style={{ color: '#f472b6' }}>{fmtDuree(fac?.dureeMoyMin ?? null)}</div>
                <div className="tb-biglbl">Durée moyenne<br /><b>À facturer → Terminé</b></div>
              </div>
              <div className="tb-bigstat">
                <div className="tb-bigval" style={{ color: '#4ade80' }}>{ops?.cloturesJour ?? '—'}</div>
                <div className="tb-biglbl">Dossiers clôturés<br /><b>aujourd'hui</b></div>
              </div>
              <div className="tb-bigstat">
                <div className="tb-bigval" style={{ color: '#38bdf8' }}>{fac?.total ?? '—'}</div>
                <div className="tb-biglbl">Fiches facturées<br /><b>30 derniers jours</b></div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="tb-foot">
        <div className="tb-dotsnav">
          {Array.from({ length: SLIDES }).map((_, i) => <span key={i} className={`tb-navdot ${i === slide ? 'on' : ''}`} />)}
        </div>
        <div className="tb-progress"><div className="tb-progressfill" style={{ width: `${progress}%` }} /></div>
        <div className="tb-updated">MAJ {data ? new Date(data.at).toLocaleTimeString('fr-BE') : '—'}</div>
      </footer>

      <style>{CSS}</style>
    </div>
  )
}

function Tile({ label, value, color, hint, sub }: { label: string; value?: number; color: string; hint: string; sub?: string }) {
  return (
    <div className="tb-tile" style={{ ['--c' as any]: color }}>
      <div className="tb-tilelbl">{label}</div>
      <div className="tb-tileval">{value ?? '—'}</div>
      <div className="tb-tilebot">
        <span className="tb-tilehint">{hint}</span>
        {sub && <span className="tb-tilesub">{sub}</span>}
      </div>
    </div>
  )
}

const BAR_COLORS = ['#38bdf8', '#a78bfa', '#fb923c', '#34d399', '#fbbf24', '#f472b6', '#60a5fa', '#f87171']

const CSS = `
.tb-root{position:fixed;inset:0;background:radial-gradient(1200px 800px at 70% -10%,#16233b 0%,#0a0e17 55%);color:#e8edf5;
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;flex-direction:column;overflow:hidden}
.tb-center{align-items:center;justify-content:center}
*{box-sizing:border-box}
.tb-head{display:flex;align-items:center;justify-content:space-between;padding:2vh 3vw 1vh}
.tb-brand{font-size:clamp(18px,2.2vw,34px);font-weight:800;letter-spacing:.02em}
.tb-brand-sub{color:#8b96a8;font-weight:600;font-size:.62em}
.tb-headright{display:flex;align-items:center;gap:2vw}
.tb-live{color:#4ade80;font-weight:700;font-size:clamp(13px,1.3vw,20px);letter-spacing:.03em}
.tb-live.off{color:#fbbf24;animation:tb-blink 1s steps(2) infinite}
@keyframes tb-blink{50%{opacity:.35}}
.tb-clock{font-variant-numeric:tabular-nums;font-weight:800;font-size:clamp(20px,2.4vw,40px);letter-spacing:.04em}
.tb-main{flex:1;position:relative}
.tb-slide{position:absolute;inset:0;padding:1vh 3vw 2vh;opacity:0;transform:scale(.985);transition:opacity .6s ease,transform .6s ease;pointer-events:none}
.tb-slide.show{opacity:1;transform:none;pointer-events:auto}
.tb-grid6{height:100%;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(2,1fr);gap:min(2.4vw,28px)}
.tb-tile{border:1px solid rgba(255,255,255,.07);border-radius:22px;background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.015));
  padding:clamp(14px,2vw,34px);display:flex;flex-direction:column;justify-content:center;position:relative;overflow:hidden}
.tb-tile::before{content:"";position:absolute;left:0;top:0;bottom:0;width:8px;background:var(--c);box-shadow:0 0 30px var(--c)}
.tb-tilelbl{color:#aeb9cc;font-weight:700;font-size:clamp(15px,1.5vw,26px);text-transform:uppercase;letter-spacing:.04em}
.tb-tileval{font-weight:900;font-variant-numeric:tabular-nums;line-height:.95;color:var(--c);
  font-size:clamp(56px,10vw,180px);text-shadow:0 0 40px color-mix(in srgb,var(--c) 45%,transparent);margin:.05em 0}
.tb-tilebot{display:flex;align-items:center;justify-content:space-between;gap:1vw;flex-wrap:wrap}
.tb-tilehint{color:#7b8698;font-weight:600;font-size:clamp(12px,1.1vw,19px)}
.tb-tilesub{color:var(--c);font-weight:800;font-size:clamp(13px,1.2vw,22px);background:color-mix(in srgb,var(--c) 16%,transparent);
  border:1px solid color-mix(in srgb,var(--c) 40%,transparent);border-radius:999px;padding:.15em .7em;white-space:nowrap;font-variant-numeric:tabular-nums}
.tb-fac{height:100%;display:grid;grid-template-columns:1.6fr 1fr;gap:min(2.4vw,28px)}
.tb-facleft,.tb-facright{border:1px solid rgba(255,255,255,.07);border-radius:22px;background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.012));padding:clamp(16px,2vw,34px)}
.tb-facright{display:flex;flex-direction:column;gap:min(2vh,22px);justify-content:space-between}
.tb-facttl{color:#aeb9cc;font-weight:800;font-size:clamp(16px,1.6vw,28px);margin-bottom:2vh}
.tb-facttl span{color:#7b8698;font-weight:600}
.tb-bars{display:flex;flex-direction:column;gap:min(1.8vh,20px)}
.tb-barrow{display:grid;grid-template-columns:minmax(120px,22%) 1fr auto;align-items:center;gap:1.2vw}
.tb-barname{font-weight:700;font-size:clamp(15px,1.5vw,26px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tb-bartrack{height:clamp(20px,2.6vh,34px);background:rgba(255,255,255,.06);border-radius:999px;overflow:hidden}
.tb-barfill{height:100%;border-radius:999px;transition:width .6s ease;box-shadow:0 0 20px rgba(255,255,255,.12) inset}
.tb-barpct{font-weight:800;font-variant-numeric:tabular-nums;font-size:clamp(16px,1.6vw,28px);white-space:nowrap}
.tb-barcount{color:#7b8698;font-weight:600;font-size:.72em}
.tb-empty{color:#7b8698;font-size:clamp(15px,1.5vw,24px);padding:4vh 0}
.tb-bigstat{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;border-radius:16px;background:rgba(255,255,255,.02)}
.tb-bigval{font-weight:900;font-variant-numeric:tabular-nums;line-height:1;font-size:clamp(40px,5.5vw,96px)}
.tb-biglbl{color:#9aa6ba;font-weight:600;font-size:clamp(13px,1.2vw,22px);margin-top:.4em;line-height:1.3}
.tb-foot{display:flex;align-items:center;gap:2vw;padding:1vh 3vw 2vh}
.tb-dotsnav{display:flex;gap:10px}
.tb-navdot{width:12px;height:12px;border-radius:50%;background:rgba(255,255,255,.2)}
.tb-navdot.on{background:#e8edf5;box-shadow:0 0 12px rgba(255,255,255,.5)}
.tb-progress{flex:1;height:6px;background:rgba(255,255,255,.08);border-radius:999px;overflow:hidden}
.tb-progressfill{height:100%;background:linear-gradient(90deg,#38bdf8,#4ade80);border-radius:999px}
.tb-updated{color:#7b8698;font-weight:600;font-size:clamp(12px,1.1vw,18px);font-variant-numeric:tabular-nums}
/* PIN */
.tb-pinbox{width:min(90vw,420px);text-align:center}
.tb-pintitle{font-size:26px;font-weight:800}
.tb-pinsub{color:#8b96a8;margin:8px 0 26px;font-weight:600;letter-spacing:.03em}
.tb-dots{display:flex;justify-content:center;gap:16px;margin-bottom:8px}
.tb-dot{width:18px;height:18px;border-radius:50%;border:2px solid rgba(255,255,255,.3)}
.tb-dot.on{background:#4ade80;border-color:#4ade80;box-shadow:0 0 14px #4ade80}
.tb-shake{animation:tb-shk .4s}
@keyframes tb-shk{25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}
.tb-pinerr{color:#f87171;font-weight:700;margin:10px 0}
.tb-pad{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:26px}
.tb-key{aspect-ratio:1.7/1;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:rgba(255,255,255,.04);
  color:#e8edf5;font-size:30px;font-weight:800;cursor:pointer;transition:background .12s,transform .05s}
.tb-key:hover{background:rgba(255,255,255,.1)}
.tb-key:active{transform:scale(.95)}
.tb-key-sm{font-size:22px;color:#9aa6ba}
`
