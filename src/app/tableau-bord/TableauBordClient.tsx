'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

// Mur d'écran ops — page publique protégée par PIN. Une seule page, temps réel
// (polling 10s). Compteurs alignés sur les onglets du dispatch. Olivier 2026-07-30.

interface Kpi {
  at: string
  ops: {
    enCommande: number; enAttente: number; assignees: number; enCours: number
    aFacturer: number; enParc: number; enParcKK1: number
    termineesJour: number; factureesJour: number
  }
  facturation: { periodeJours: number; dureeMoyMin: number | null }
}

const POLL_MS = 10_000

const fmtDuree = (min: number | null) => {
  if (min == null) return '—'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60), m = min % 60
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`
}
const two = (n: number) => String(n).padStart(2, '0')

export default function TableauBordClient() {
  const [pin, setPin]       = useState('')
  const [authed, setAuthed] = useState(false)
  const [pinErr, setPinErr] = useState(false)
  const [data, setData]     = useState<Kpi | null>(null)
  const [stale, setStale]   = useState(false)
  const [clock, setClock]   = useState('')
  const [slide, setSlide]   = useState(0)
  const [progress, setProgress] = useState(0)
  const savedPin = useRef('')
  const rotateS  = useRef(30)
  const slideCountRef = useRef(1)

  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date()
      setClock(`${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`)
    }, 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search)
      const r = parseInt(sp.get('rotate') || '')
      if (r >= 3 && r <= 300) rotateS.current = r
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

  useEffect(() => {
    if (!authed) return
    fetchData()
    const t = setInterval(fetchData, POLL_MS)
    const s = setInterval(() => setStale(true), POLL_MS * 3)
    return () => { clearInterval(t); clearInterval(s) }
  }, [authed, fetchData])

  // Rotation des slides (ne tourne qu'à partir de 2 slides). Prête pour de futurs
  // écrans : ajouter des entrées dans `slides` ci-dessous.
  useEffect(() => {
    if (!authed) return
    let p = 0
    const step = 100 / (rotateS.current * 10)
    const t = setInterval(() => {
      if (slideCountRef.current <= 1) { setProgress(0); return }
      p += step
      if (p >= 100) { p = 0; setSlide(s => (s + 1) % slideCountRef.current) }
      setProgress(p)
    }, 100)
    return () => clearInterval(t)
  }, [authed])

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

  const o = data?.ops
  const f = data?.facturation

  // Slides du mur. Aujourd'hui 1 seule ; en ajouter ici fait tourner la rotation.
  const slides = [
    <div className="tb-grid8" key="ops">
      <Tile label="En commande" value={o?.enCommande} color="#a78bfa" hint="onglet dispatch" />
      <Tile label="En attente"  value={o?.enAttente}  color="#fbbf24" hint="à dispatcher" />
      <DualTile label="Assignée / En cours" color="#38bdf8"
        a={o?.assignees} aLabel="Assignée" b={o?.enCours} bLabel="En cours" />
      <Tile label="À facturer"  value={o?.aFacturer}  color="#fb923c" hint="file facturation" />
      <Tile label="Parc K + K1" value={o?.enParcKK1} color="#34d399" hint="véhicules zones K + K1"
        sub={o ? `Total parc : ${o.enParc}` : undefined} />
      <Tile label="Terminées aujourd'hui" value={o?.termineesJour} color="#4ade80" hint="chauffeur a bouclé" />
      <Tile label="Facturées aujourd'hui" value={o?.factureesJour} color="#22d3ee" hint="facturation validée" />
      <Tile label="Délai moyen à facturer" valueStr={fmtDuree(f?.dureeMoyMin ?? null)} color="#f472b6"
        hint={`À facturer → Terminé · ${f?.periodeJours ?? 7} j`} />
    </div>,
  ]
  slideCountRef.current = slides.length
  const cur = Math.min(slide, slides.length - 1)

  return (
    <div className="tb-root">
      <header className="tb-head">
        <div className="tb-brand">VD&nbsp;Soft <span className="tb-brand-sub">· Opérations en direct</span></div>
        <div className="tb-headright">
          <span className={`tb-live ${stale ? 'off' : ''}`}>● {stale ? 'reconnexion…' : 'en direct'}</span>
          <span className="tb-clock">{clock}</span>
        </div>
      </header>

      <main className="tb-main">
        {slides.map((node, i) => (
          <section key={i} className={`tb-slide ${i === cur ? 'show' : ''}`}>{node}</section>
        ))}
      </main>

      <footer className="tb-foot">
        {slides.length > 1 && (
          <>
            <div className="tb-dotsnav">
              {slides.map((_, i) => <span key={i} className={`tb-navdot ${i === cur ? 'on' : ''}`} />)}
            </div>
            <div className="tb-progress"><div className="tb-progressfill" style={{ width: `${progress}%` }} /></div>
          </>
        )}
        <span className="tb-updated">MAJ auto {POLL_MS / 1000}s · dernière {data ? new Date(data.at).toLocaleTimeString('fr-BE') : '—'}</span>
      </footer>

      <style>{CSS}</style>
    </div>
  )
}

function Tile({ label, value, valueStr, color, hint, sub }: { label: string; value?: number; valueStr?: string; color: string; hint: string; sub?: string }) {
  return (
    <div className="tb-tile" style={{ ['--c' as any]: color }}>
      <div className="tb-tilelbl">{label}</div>
      <div className={`tb-tileval ${valueStr ? 'tb-tileval-str' : ''}`}>{valueStr ?? value ?? '—'}</div>
      <div className="tb-tilebot">
        <span className="tb-tilehint">{hint}</span>
        {sub && <span className="tb-tilesub">{sub}</span>}
      </div>
    </div>
  )
}

function DualTile({ label, color, a, aLabel, b, bLabel }: { label: string; color: string; a?: number; aLabel: string; b?: number; bLabel: string }) {
  return (
    <div className="tb-tile" style={{ ['--c' as any]: color }}>
      <div className="tb-tilelbl">{label}</div>
      <div className="tb-dual">
        <div className="tb-dualcol"><div className="tb-dualval">{a ?? '—'}</div><div className="tb-duallbl">{aLabel}</div></div>
        <div className="tb-dualsep" />
        <div className="tb-dualcol"><div className="tb-dualval">{b ?? '—'}</div><div className="tb-duallbl">{bLabel}</div></div>
      </div>
      <div className="tb-tilebot"><span className="tb-tilehint">missions actives</span></div>
    </div>
  )
}

const CSS = `
.tb-root{position:fixed;inset:0;background:radial-gradient(1200px 800px at 70% -10%,#16233b 0%,#0a0e17 55%);color:#e8edf5;
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;flex-direction:column;overflow:hidden}
.tb-center{align-items:center;justify-content:center}
*{box-sizing:border-box}
.tb-head{display:flex;align-items:center;justify-content:space-between;padding:1.6vh 2.4vw .8vh}
.tb-brand{font-size:clamp(18px,2.1vw,34px);font-weight:800;letter-spacing:.02em}
.tb-brand-sub{color:#8b96a8;font-weight:600;font-size:.62em}
.tb-headright{display:flex;align-items:center;gap:2vw}
.tb-live{color:#4ade80;font-weight:700;font-size:clamp(13px,1.3vw,20px);letter-spacing:.03em}
.tb-live.off{color:#fbbf24;animation:tb-blink 1s steps(2) infinite}
@keyframes tb-blink{50%{opacity:.35}}
.tb-clock{font-variant-numeric:tabular-nums;font-weight:800;font-size:clamp(20px,2.3vw,40px);letter-spacing:.04em}
.tb-main{flex:1;position:relative;min-height:0}
.tb-slide{position:absolute;inset:0;display:flex;flex-direction:column;opacity:0;transform:scale(.99);
  transition:opacity .5s ease,transform .5s ease;pointer-events:none}
.tb-slide.show{opacity:1;transform:none;pointer-events:auto}
.tb-grid8{flex:1;display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(2,1fr);
  gap:min(1.6vw,22px);padding:.6vh 2.4vw 1vh}
.tb-tile{border:1px solid rgba(255,255,255,.07);border-radius:20px;background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.015));
  padding:clamp(12px,1.5vw,26px);display:flex;flex-direction:column;justify-content:center;position:relative;overflow:hidden;min-width:0}
.tb-tile::before{content:"";position:absolute;left:0;top:0;bottom:0;width:7px;background:var(--c);box-shadow:0 0 26px var(--c)}
.tb-tilelbl{color:#aeb9cc;font-weight:700;font-size:clamp(13px,1.25vw,24px);text-transform:uppercase;letter-spacing:.03em;line-height:1.15}
.tb-tileval{font-weight:900;font-variant-numeric:tabular-nums;line-height:.92;color:var(--c);
  font-size:clamp(48px,7.4vw,150px);text-shadow:0 0 40px color-mix(in srgb,var(--c) 45%,transparent);margin:.04em 0}
.tb-tileval-str{font-size:clamp(38px,5.2vw,104px)}
.tb-tilebot{display:flex;align-items:center;justify-content:space-between;gap:.6vw;flex-wrap:wrap}
.tb-tilehint{color:#7b8698;font-weight:600;font-size:clamp(11px,1vw,18px)}
.tb-tilesub{color:var(--c);font-weight:800;font-size:clamp(12px,1.1vw,20px);background:color-mix(in srgb,var(--c) 16%,transparent);
  border:1px solid color-mix(in srgb,var(--c) 40%,transparent);border-radius:999px;padding:.12em .6em;white-space:nowrap;font-variant-numeric:tabular-nums}
.tb-dual{display:flex;align-items:center;gap:1vw;margin:.1em 0}
.tb-dualcol{flex:1;text-align:center;min-width:0}
.tb-dualval{font-weight:900;font-variant-numeric:tabular-nums;line-height:.95;color:var(--c);
  font-size:clamp(40px,5.6vw,120px);text-shadow:0 0 34px color-mix(in srgb,var(--c) 45%,transparent)}
.tb-duallbl{color:#9aa6ba;font-weight:700;font-size:clamp(11px,1vw,19px);text-transform:uppercase;letter-spacing:.03em}
.tb-dualsep{width:2px;align-self:stretch;background:linear-gradient(180deg,transparent,rgba(255,255,255,.18),transparent)}
.tb-foot{display:flex;align-items:center;gap:1.6vw;padding:.4vh 2.4vw 1.2vh}
.tb-dotsnav{display:flex;gap:9px}
.tb-navdot{width:11px;height:11px;border-radius:50%;background:rgba(255,255,255,.2)}
.tb-navdot.on{background:#e8edf5;box-shadow:0 0 10px rgba(255,255,255,.5)}
.tb-progress{flex:1;height:5px;background:rgba(255,255,255,.08);border-radius:999px;overflow:hidden}
.tb-progressfill{height:100%;background:linear-gradient(90deg,#38bdf8,#4ade80);border-radius:999px;transition:width .1s linear}
.tb-updated{margin-left:auto;color:#6b7688;font-weight:600;font-size:clamp(11px,1vw,17px);font-variant-numeric:tabular-nums}
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
