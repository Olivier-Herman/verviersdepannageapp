'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

// Mur d'écran ops — page publique protégée par PIN. Une seule page, temps réel
// (polling 10s). Compteurs alignés sur les onglets du dispatch. Olivier 2026-07-30.

interface Kpi {
  at: string
  ops: {
    enCommande: number; enAttente: number; assignees: number; enCours: number
    aFacturer: number; enParc: number; aRelivrer: number
    termineesJour: number; factureesJour: number
  }
  facturation: { periodeJours: number; dureeMoyMin: number | null; dureeMoyN?: number }
  sources?: {
    parSource: { key: string; label: string; hex: string; count: number }[]
    touring: { bko: number; total: number }
    allianz: { cloture: number | null; total: number }
  }
  chauffeurs?: { jour: DrvRow[]; semaine: DrvRow[]; mois: DrvRow[] }
  enCours?: { id: string; missionNumber: number | null; driver: string; plate: string; vehicle: string; category: string; city: string; statusLabel: string; since: string | null }[]
  domaine?: { aTransferer: number; aPreparer: number; enAttenteEnlevement: number }
  perf?: { parChauffeur: PerfRow[]; global: { acceptMin: number | null; routeMin: number | null; traitMin: number | null } }
}

type DrvRow = { driver: string; total: number; forced?: number; REM: number; DSP: number; REL: number; Transport: number; DPR: number; autre: number; avgMin: number | null; km?: number }
type PerfRow = { driver: string; count: number; forced?: number; acceptMin: number | null; routeMin: number | null; traitMin: number | null }

const CAT_COLOR: Record<string, string> = { REM: '#38bdf8', DSP: '#4ade80', REL: '#a78bfa', Transport: '#fb923c', DPR: '#fbbf24', Autre: '#64748b' }
function elapsed(since: string | null): { txt: string; sev: number } {
  if (!since) return { txt: '—', sev: 0 }
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(since)) / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  const txt = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
  const sev = s >= 7200 ? 2 : s >= 3600 ? 1 : 0   // ≥2h rouge, ≥1h orange
  return { txt, sev }
}

const POLL_MS = 10_000

const fmtDuree = (min: number | null) => {
  if (min == null) return '—'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60), m = min % 60
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`
}
const two = (n: number) => String(n).padStart(2, '0')

export default function TableauBordClient({ variant = 'full' }: { variant?: 'full' | 'dispatch' }) {
  const isDispatch = variant === 'dispatch'
  const [pin, setPin]       = useState('')
  const [authed, setAuthed] = useState(false)
  const [pinErr, setPinErr] = useState(false)
  const [data, setData]     = useState<Kpi | null>(null)
  const [stale, setStale]   = useState(false)
  const [clock, setClock]   = useState('')
  const [slide, setSlide]   = useState(0)
  const [progress, setProgress] = useState(0)
  const savedPin = useRef('')
  const rotateS  = useRef(15)
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

  // Saisie clavier du PIN (chiffres physiques + pavé numérique, ⌫, Échap).
  useEffect(() => {
    if (authed) return
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key) }
      else if (e.key === 'Backspace') { e.preventDefault(); setPinErr(false); setPin(p => p.slice(0, -1)) }
      else if (e.key === 'Escape') { setPin(''); setPinErr(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed])

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
  const s = data?.sources
  const ch = data?.chauffeurs
  const ec = data?.enCours || []
  const dm = data?.domaine
  const pf = data?.perf

  // Tuiles ops (4 communes ; +4 réservées au mur complet).
  const opsTiles = (
    <>
      <Tile label="En commande" value={o?.enCommande} color="#a78bfa" hint="onglet dispatch" />
      <Tile label="En attente"  value={o?.enAttente}  color="#fbbf24" hint="à dispatcher" />
      <DualTile label="Assignée / En cours" color="#38bdf8"
        a={o?.assignees} aLabel="Assignée" b={o?.enCours} bLabel="En cours" />
      {!isDispatch && <Tile label="À facturer"  value={o?.aFacturer}  color="#fb923c" hint="file facturation" />}
      <Tile label="À relivrer" value={o?.aRelivrer} color="#34d399" hint="parc K + K1"
        sub={!isDispatch && o ? `Total parc : ${o.enParc}` : undefined} />
      {!isDispatch && <Tile label="Terminées aujourd'hui" value={o?.termineesJour} color="#4ade80" hint="chauffeur a bouclé" />}
      {!isDispatch && <Tile label="Facturées aujourd'hui" value={o?.factureesJour} color="#22d3ee" hint="facturation validée" />}
      {!isDispatch && <Tile label={`Délai médian à facturer${f?.dureeMoyN != null ? ` (${f.dureeMoyN})` : ''}`} valueStr={fmtDuree(f?.dureeMoyMin ?? null)} color="#f472b6"
        hint={`Terminé → facturé · médiane ${f?.periodeJours ?? 7} j`} />}
    </>
  )

  // Tableau des missions en cours & assignées (réutilisé mur + dispatch).
  const enCoursPanel = (
    <div className="tb-panel" key="encours">
      <div className="tb-panel-ttl">Missions en cours &amp; assignées <span>· {ec.length} · compteur depuis l'assignation</span></div>
      <div className="tb-ec-list">
        {ec.map(m => {
          const e = elapsed(m.since)
          return (
            <div className="tb-ec-row" key={m.id}>
              <span className="tb-ec-cat" style={{ background: `${CAT_COLOR[m.category] || CAT_COLOR.Autre}22`, color: CAT_COLOR[m.category] || CAT_COLOR.Autre, borderColor: `${CAT_COLOR[m.category] || CAT_COLOR.Autre}66` }}>{m.category}</span>
              <span className="tb-ec-num">{m.missionNumber ? `#${m.missionNumber}` : '—'}</span>
              <span className="tb-ec-drv">{m.driver}</span>
              <span className="tb-ec-veh">{[m.plate, m.vehicle].filter(Boolean).join(' · ') || '—'}</span>
              <span className="tb-ec-city">{m.city || '—'}</span>
              <span className="tb-ec-st">{m.statusLabel}</span>
              <span className={`tb-ec-timer sev${e.sev}`}>{e.txt}</span>
            </div>
          )
        })}
        {!ec.length && <div className="tb-empty">Aucune mission en cours.</div>}
      </div>
    </div>
  )

  const chPanels = [
    <ChauffeurPanel key="ch-jour" title="Missions du jour par chauffeur"          rows={ch?.jour} empty="Aucune mission attribuée aujourd'hui." />,
    <ChauffeurPanel key="ch-sem"  title="Missions des 7 derniers jours par chauffeur" rows={ch?.semaine} empty="Aucune mission sur 7 jours." />,
    <ChauffeurPanel key="ch-mois" title="Missions du mois en cours par chauffeur"  rows={ch?.mois} empty="Aucune mission ce mois-ci." />,
  ]

  // Coquille commune (header / rotation / footer) — partagée mur + dispatch.
  const renderShell = (shownSlides: any[], cur: number) => (
    <div className="tb-root">
      <header className="tb-head">
        <div className="tb-brand">VD&nbsp;Soft <span className="tb-brand-sub">· {isDispatch ? 'Dispatch en direct' : 'Opérations en direct'}</span></div>
        <div className="tb-headright">
          <span className={`tb-live ${stale ? 'off' : ''}`}>● {stale ? 'reconnexion…' : 'en direct'}</span>
          <span className="tb-clock">{clock}</span>
        </div>
      </header>

      <main className="tb-main">
        {shownSlides.map((node, i) => (
          <section key={i} className={`tb-slide ${i === cur ? 'show' : ''}`}>{node}</section>
        ))}
      </main>

      <footer className="tb-foot">
        {shownSlides.length > 1 && (
          <>
            <div className="tb-dotsnav">
              {shownSlides.map((_, i) => <span key={i} className={`tb-navdot ${i === cur ? 'on' : ''}`} />)}
            </div>
            <div className="tb-progress"><div className="tb-progressfill" style={{ width: `${progress}%` }} /></div>
          </>
        )}
        <span className="tb-updated">MAJ auto {POLL_MS / 1000}s · dernière {data ? new Date(data.at).toLocaleTimeString('fr-BE') : '—'}</span>
      </footer>

      <style>{CSS}</style>
    </div>
  )

  // Vue DISPATCH (/boarding, Momo) : 1er écran = 4 cards en ligne + tableau des
  // missions juste en dessous, puis les stats chauffeur.
  if (isDispatch) {
    const shownSlides = [
      <div className="tb-dispatch-home" key="home">
        <div className="tb-row4">{opsTiles}</div>
        {enCoursPanel}
      </div>,
      ...chPanels,
    ]
    slideCountRef.current = shownSlides.length
    const cur = Math.min(slide, shownSlides.length - 1)
    return renderShell(shownSlides, cur)
  }

  // Slides du mur complet. En ajouter ici fait tourner la rotation.
  const slides = [
    <div className="tb-grid8" key="ops">{opsTiles}</div>,

    <div className="tb-src" key="sources">
      <div className="tb-src-featured">
        <RatioCard label="Touring" color="#3b82f6"
          a={s?.touring.bko} b={s?.touring.total} aLbl="COMEX BKO" bLbl="Touring à facturer" />
        <RatioCard label="Allianz / Mondial" color="#a855f7"
          a={s?.allianz.cloture ?? undefined} b={s?.allianz.total} aLbl="Clôtures prêtes" bLbl="Allianz à facturer" />
      </div>
      <div className="tb-src-list">
        <div className="tb-src-title">À facturer par source <span>· {(s?.parSource || []).reduce((n, x) => n + x.count, 0)} dossiers</span></div>
        <div className="tb-src-rows">
          {(s?.parSource || []).map(x => (
            <div className="tb-src-row" key={x.key}>
              <span className="tb-src-dot" style={{ background: x.hex }} />
              <span className="tb-src-lbl">{x.label}</span>
              <span className="tb-src-cnt">{x.count}</span>
            </div>
          ))}
          {!s?.parSource?.length && <div className="tb-empty">Aucun dossier à facturer.</div>}
        </div>
      </div>
    </div>,

    ...chPanels,
    <PerfPanel key="perf" perf={pf} />,

    enCoursPanel,

    <div className="tb-domaine" key="domaine">
      <Tile label="À transférer en Domaine" value={dm?.aTransferer} color="#a78bfa" hint="remis au Domaine, pas encore en zone I" />
      <Tile label="À préparer pour enlèvement" value={dm?.aPreparer} color="#fbbf24" hint="épaves vendues, préparation non faite" />
      <Tile label="Préparé, en attente d'enlèvement" value={dm?.enAttenteEnlevement} color="#34d399" hint="prêt, on attend l'enlèvement par la firme" />
    </div>,
  ]
  slideCountRef.current = slides.length
  return renderShell(slides, Math.min(slide, slides.length - 1))
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

function RatioCard({ label, color, a, b, aLbl, bLbl }: { label: string; color: string; a?: number; b?: number; aLbl: string; bLbl: string }) {
  return (
    <div className="tb-tile" style={{ ['--c' as any]: color }}>
      <div className="tb-tilelbl">{label}</div>
      <div className="tb-ratio">
        <span className="tb-ratio-a">{a ?? '—'}</span>
        <span className="tb-ratio-sep">/</span>
        <span className="tb-ratio-b">{b ?? '—'}</span>
      </div>
      <div className="tb-tilebot"><span className="tb-tilehint">{aLbl} · {bLbl}</span></div>
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

function ChauffeurPanel({ title, rows, empty }: { title: string; rows?: DrvRow[]; empty: string }) {
  const list = rows || []
  return (
    <div className="tb-panel">
      <div className="tb-panel-ttl">{title} <span>· DSP / REM / REL / Transport / DPR · temps moyen hors fiches forcées</span></div>
      <div className="tb-tblwrap">
        <table className="tb-tbl">
          <thead><tr>
            <th className="l">Chauffeur</th><th>Total</th><th>REM</th><th>DSP</th><th>REL</th><th>Transp.</th><th>DPR</th><th>Temps moy.</th><th>Km</th><th>Forcées</th>
          </tr></thead>
          <tbody>
            {list.map((d, i) => (
              <tr key={i}>
                <td className="l tb-drv">{d.driver}</td>
                <td className="tb-tot">{d.total}</td>
                <td style={{ color: CAT_COLOR.REM }}>{d.REM || '·'}</td>
                <td style={{ color: CAT_COLOR.DSP }}>{d.DSP || '·'}</td>
                <td style={{ color: CAT_COLOR.REL }}>{d.REL || '·'}</td>
                <td style={{ color: CAT_COLOR.Transport }}>{d.Transport || '·'}</td>
                <td style={{ color: CAT_COLOR.DPR }}>{d.DPR || '·'}</td>
                <td className="tb-avg">{d.avgMin != null ? fmtDuree(d.avgMin) : '—'}</td>
                <td style={{ color: '#a78bfa' }}>{d.km ? `${d.km} km` : '·'}</td>
                <td style={{ color: d.forced ? '#f87171' : '#64748b' }}>{d.forced || '·'}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={10} className="tb-empty">{empty}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PerfPanel({ perf }: { perf?: { parChauffeur: PerfRow[]; global: { acceptMin: number | null; routeMin: number | null; traitMin: number | null } } }) {
  const list = perf?.parChauffeur || []
  const g = perf?.global
  const cell = (v: number | null) => (v != null ? fmtDuree(v) : '—')
  return (
    <div className="tb-panel">
      <div className="tb-panel-ttl">Performance chauffeurs <span>· mois en cours · moyennes hors fiches forcées par le dispatch</span></div>
      <div className="tb-tblwrap">
        <table className="tb-tbl">
          <thead><tr>
            <th className="l">Chauffeur</th><th>Missions</th><th>Acceptation</th><th>Départ en route</th><th>Traitement complet</th><th>Forcées</th>
          </tr></thead>
          <tbody>
            {list.map((d, i) => (
              <tr key={i}>
                <td className="l tb-drv">{d.driver}</td>
                <td className="tb-tot">{d.count}</td>
                <td style={{ color: '#38bdf8' }}>{cell(d.acceptMin)}</td>
                <td style={{ color: '#fbbf24' }}>{cell(d.routeMin)}</td>
                <td style={{ color: '#4ade80' }}>{cell(d.traitMin)}</td>
                <td style={{ color: d.forced ? '#f87171' : '#64748b' }}>{d.forced || 0}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={6} className="tb-empty">Aucune donnée ce mois-ci.</td></tr>}
          </tbody>
          <tfoot><tr className="tb-team">
            <td className="l">🏁 Équipe (moyenne)</td><td className="tb-tot">—</td>
            <td style={{ color: '#38bdf8' }}>{cell(g?.acceptMin ?? null)}</td>
            <td style={{ color: '#fbbf24' }}>{cell(g?.routeMin ?? null)}</td>
            <td style={{ color: '#4ade80' }}>{cell(g?.traitMin ?? null)}</td>
            <td style={{ color: '#f87171' }}>{list.reduce((n, d) => n + (d.forced || 0), 0)}</td>
          </tr></tfoot>
        </table>
      </div>
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
/* Vue dispatch : 4 tuiles en 2×2, plus grandes et lisibles au mur. */
.tb-grid4{flex:1;display:grid;grid-template-columns:repeat(2,1fr);grid-template-rows:repeat(2,1fr);
  gap:min(2.2vw,32px);padding:1.4vh 3vw 2vh}
.tb-grid4 .tb-tile{border-radius:26px;padding:clamp(20px,2.4vw,44px)}
.tb-grid4 .tb-tilelbl{font-size:clamp(18px,1.9vw,34px)}
.tb-grid4 .tb-tileval{font-size:clamp(72px,10vw,210px)}
.tb-grid4 .tb-tilehint{font-size:clamp(13px,1.2vw,22px)}
.tb-grid4 .tb-tile::before{width:10px}
/* Home dispatch (/boarding) : 4 cards en une ligne + tableau missions dessous. */
.tb-dispatch-home{flex:1;display:flex;flex-direction:column;gap:min(1.6vw,22px);padding:1vh 2.4vw 1.4vh;min-height:0}
.tb-row4{display:grid;grid-template-columns:repeat(4,1fr);gap:min(1.6vw,22px);height:30vh;flex:0 0 auto}
.tb-row4 .tb-tile{border-radius:22px;padding:clamp(14px,1.8vw,32px)}
.tb-row4 .tb-tilelbl{font-size:clamp(15px,1.5vw,28px)}
.tb-row4 .tb-tileval{font-size:clamp(56px,7vw,150px)}
.tb-dispatch-home .tb-panel{flex:1 1 auto;min-height:0}
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
/* Slide 2 : sources */
.tb-src{flex:1;display:grid;grid-template-columns:1fr 1.15fr;gap:min(1.6vw,22px);padding:.6vh 2.4vw 1vh;min-height:0}
.tb-src-featured{display:flex;flex-direction:column;gap:min(1.6vw,22px);min-height:0}
.tb-src-featured .tb-tile{flex:1}
.tb-ratio{display:flex;align-items:baseline;justify-content:center;gap:.15em;margin:.05em 0}
.tb-ratio-a{font-weight:900;font-variant-numeric:tabular-nums;color:var(--c);line-height:.9;
  font-size:clamp(50px,8vw,150px);text-shadow:0 0 40px color-mix(in srgb,var(--c) 45%,transparent)}
.tb-ratio-sep{font-weight:800;color:#5b6675;font-size:clamp(34px,5vw,90px);opacity:.6}
.tb-ratio-b{font-weight:800;font-variant-numeric:tabular-nums;color:#c8d2e0;line-height:.9;font-size:clamp(40px,6vw,110px)}
.tb-src-list{border:1px solid rgba(255,255,255,.07);border-radius:20px;background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.012));
  padding:clamp(14px,1.6vw,26px);display:flex;flex-direction:column;min-height:0}
.tb-src-title{color:#aeb9cc;font-weight:800;font-size:clamp(15px,1.5vw,26px);margin-bottom:1.4vh}
.tb-src-title span{color:#7b8698;font-weight:600}
.tb-src-rows{flex:1;display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:min-content;gap:.6vh 2vw;overflow:hidden;align-content:start}
.tb-src-row{display:flex;align-items:center;gap:.8vw;border-bottom:1px solid rgba(255,255,255,.06);padding:.5vh 0}
.tb-src-dot{width:clamp(11px,1vw,16px);height:clamp(11px,1vw,16px);border-radius:50%;flex:0 0 auto;box-shadow:0 0 10px currentColor}
.tb-src-lbl{flex:1;font-weight:700;font-size:clamp(14px,1.35vw,24px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tb-src-cnt{font-weight:900;font-variant-numeric:tabular-nums;font-size:clamp(18px,1.8vw,32px);color:#e8edf5}
.tb-empty{color:#7b8698;font-size:clamp(15px,1.5vw,24px);padding:4vh 0;text-align:center}
/* Panels génériques (par chauffeur / en cours) */
.tb-panel{flex:1;display:flex;flex-direction:column;border:1px solid rgba(255,255,255,.07);border-radius:20px;
  background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.012));padding:clamp(14px,1.8vw,28px);margin:.6vh 2.4vw 1vh;min-height:0}
.tb-panel-ttl{color:#aeb9cc;font-weight:800;font-size:clamp(16px,1.7vw,30px);margin-bottom:1.4vh;flex:0 0 auto}
.tb-panel-ttl span{color:#7b8698;font-weight:600;font-size:.66em}
.tb-tblwrap{flex:1;overflow:hidden}
.tb-tbl{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.tb-tbl th{color:#7b8698;font-weight:700;font-size:clamp(12px,1.1vw,20px);text-transform:uppercase;letter-spacing:.03em;text-align:center;padding:.7vh .5vw;border-bottom:1px solid rgba(255,255,255,.12)}
.tb-tbl th.l,.tb-tbl td.l{text-align:left}
.tb-tbl td{text-align:center;padding:1vh .5vw;font-size:clamp(16px,1.7vw,30px);font-weight:800;border-bottom:1px solid rgba(255,255,255,.06)}
.tb-drv{color:#e8edf5}
.tb-tot{color:#e8edf5;font-size:1.05em}
.tb-avg{color:#f472b6}
.tb-tbl tfoot td{border-top:2px solid rgba(255,255,255,.22);border-bottom:none;padding-top:1.4vh;font-size:1.05em}
.tb-team td{color:#e8edf5;font-weight:900}
.tb-ec-list{flex:1;display:flex;flex-direction:column;gap:.3vh;overflow:hidden}
.tb-ec-row{display:grid;grid-template-columns:6.5em 7em minmax(9em,1.1fr) minmax(11em,1.7fr) minmax(7em,1fr) 7em 6.5em;
  align-items:center;column-gap:1.4vw;padding:.7vh .8vw;border-bottom:1px solid rgba(255,255,255,.06);font-size:clamp(14px,1.35vw,24px)}
.tb-ec-row>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb-ec-cat{font-weight:800;font-size:.78em;border:1px solid;border-radius:999px;padding:.15em 0;text-align:center;justify-self:start;width:100%}
.tb-ec-num{font-weight:800;color:#9aa6ba;font-variant-numeric:tabular-nums}
.tb-ec-drv{font-weight:800;color:#e8edf5}
.tb-ec-veh{color:#aeb9cc}
.tb-ec-city{color:#8b96a8}
.tb-ec-st{color:#c8d2e0;font-weight:700;font-size:.85em}
.tb-ec-timer{font-weight:900;font-variant-numeric:tabular-nums;font-size:1.08em;color:#4ade80;text-align:right}
.tb-ec-timer.sev1{color:#fbbf24}
.tb-ec-timer.sev2{color:#f87171}
.tb-domaine{flex:1;display:grid;grid-template-columns:repeat(3,1fr);gap:min(2vw,26px);padding:1vh 2.4vw 1.4vh}
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
