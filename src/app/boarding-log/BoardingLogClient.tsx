'use client'
// src/app/boarding-log/BoardingLogClient.tsx
//
// JOURNAL DE BORD — écran à laisser allumé (Olivier 2026-08-14, refondu le
// 2026-09-21 d'après la maquette qu'il a validée).
//
// Trois règles données par Olivier, dans cet ordre :
//   1. « Je veux toujours voir TOUTES les missions en cours » → les cartes sont
//      dimensionnées en em et la taille de base est calculée à l'écran pour que
//      la liste rentre entièrement, sans scroll (fitMissions).
//   2. Sous chaque étape du chauffeur, l'HEURE du pointage en petit.
//   3. Le journal se limite à deux lignes visibles, scrollable pour le reste.
//
// Le reste de la maquette : une couleur par étape (le geste du chauffeur), une
// couleur par source (celle du catalogue, jamais en dur), la navette qui balaie
// l'étape en cours, la barre d'avancement de la mission, et à droite le rythme
// du jour et les chauffeurs du jour.

import { pollWhenVisible } from '@/lib/client/poll'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const POLL_MS = 15000

interface Ev { at: string; missionId: string | null; action: string; text: string; ton: 'info' | 'ok' | 'alerte'; notes: string; number: number | null; plate: string | null; source: string | null; driver: string | null; repeats?: number }
interface Ano { missionId?: string | null; level: 'rouge' | 'ambre'; titre: string; detail: string; at: string }
interface LogData { events: Ev[]; anomalies: Ano[]; rythme?: { h: number; n: number }[]; heureBxl?: number }

/** Les six gestes du terrain, dans l'ordre, avec la couleur de chacun. */
const STEPS: { key: string; label: string; color: string; soft: string }[] = [
  { key: 'assigned',   label: 'Assignée',  color: '#7A8AA0', soft: '#EBEFF5' },
  { key: 'on_way',     label: 'En route',  color: '#1B57C9', soft: '#E2EAFB' },
  { key: 'on_site',    label: 'Sur place', color: '#7A3BD6', soft: '#EEE6FC' },
  { key: 'loaded',     label: 'Chargé',    color: '#C2700A', soft: '#FCEFD9' },
  { key: 'delivering', label: 'Livraison', color: '#0B7F55', soft: '#DCF3EA' },
]
const PODIUM = ['#E11D2E', '#C2700A', '#1B57C9', '#0F7B6C', '#7A3BD6']
const NEUTRE = { color: '#647385', soft: '#EEF1F5' }

const ICONS: Record<string, string> = {
  accept: '🤝', on_way: '🚚', on_site: '📍', load_vehicle: '⬆️', park: '🅿️',
  completed: '🏁', flux2_closed: '✅', touring_closed: '🅃', vab_closed: '🅅',
  axa_closed: '🅰️', touring_synced: '🅃', vab_synced: '🅅', kaze_synced: '🅺',
  invoiced: '💶', invoice_autoposted: '💶', request_relivraison: '🔁', kaze_rel_merged: '🔗',
  force_status_to_invoice: '✋', force_status_parked: '✋', force_status_completed: '✋',
}

const hm = (s: string | null) => s ? new Date(s).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' }) : ''
const dur = (min: number | null | undefined) => min == null ? '—' : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
const depuis = (iso: string | null, nowMs: number) => {
  if (!iso) return '—'
  const s = Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`
}
const age = (iso: string, nowMs: number) => {
  const m = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60000))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}
/** Étape atteinte = dernier pointage renseigné. */
function stepIndex(steps: Record<string, string | null> | undefined): number {
  if (!steps) return 0
  let last = 0
  STEPS.forEach((s, i) => { if (steps[s.key]) last = i })
  return last
}
function stepAt(steps: Record<string, string | null> | undefined, key: string): string | null {
  if (!steps) return null
  if (key === 'assigned') return steps.assigned || steps.accepted || null
  return steps[key] || null
}

export default function BoardingLogClient() {
  const [authed, setAuthed] = useState(false)
  const [pin, setPin]       = useState('')
  const [pinErr, setPinErr] = useState(false)
  const [tb, setTb]         = useState<any>(null)
  const [log, setLog]       = useState<LogData | null>(null)
  const [stale, setStale]   = useState(false)
  const [nowMs, setNowMs]   = useState(() => Date.now())
  const savedPin  = useRef('')
  const missionsRef = useRef<HTMLDivElement | null>(null)
  const feedRef     = useRef<HTMLDivElement | null>(null)

  const fetchAll = useCallback(async () => {
    const p = savedPin.current
    if (!p) return
    try {
      const [a, b] = await Promise.all([
        fetch('/api/tableau-bord', { headers: { 'x-dashboard-pin': p }, cache: 'no-store' }).then(r => r.json()),
        fetch('/api/boarding-log',  { headers: { 'x-dashboard-pin': p }, cache: 'no-store' }).then(r => r.json()),
      ])
      if (a?.ok) setTb(a)
      if (b?.ok) setLog(b)
      setStale(false)
    } catch { setStale(true) }
  }, [])

  useEffect(() => {
    try {
      const p = sessionStorage.getItem('tb_pin')
      if (p) { savedPin.current = p; setAuthed(true) }
    } catch { /* pas de sessionStorage */ }
  }, [])

  useEffect(() => {
    if (!authed) return
    fetchAll()
    const stopT = pollWhenVisible(fetchAll, POLL_MS, { immediate: false })
    const s = setInterval(() => setStale(true), POLL_MS * 4)
    return () => { stopT(); clearInterval(s) }
  }, [authed, fetchAll])

  // Horloge + chronos : une seconde suffit, le DOM de l'écran est petit.
  useEffect(() => {
    if (!authed) return
    const t = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(t)
  }, [authed])

  // ── Tout doit tenir à l'écran ────────────────────────────────────────────
  // Le journal garde deux lignes, les missions se réduisent jusqu'à rentrer.
  // On mesure après chaque rendu : aucune donnée n'est touchée, donc pas de
  // boucle de rendu.
  const fitAll = useCallback(() => {
    const f = feedRef.current
    if (f) {
      const first = f.querySelector('.bl-ev') as HTMLElement | null
      if (first) {
        const h = first.getBoundingClientRect().height
        if (h) f.style.height = `${Math.round(h * 2)}px`
      }
    }
    const box = missionsRef.current
    if (box) {
      let px = 16, guard = 0
      box.style.fontSize = `${px}px`
      while (box.scrollHeight > box.clientHeight + 1 && px > 8 && guard++ < 40) {
        px -= 0.5
        box.style.fontSize = `${px}px`
      }
    }
  }, [])

  useLayoutEffect(() => { fitAll() })
  useEffect(() => {
    window.addEventListener('resize', fitAll)
    return () => window.removeEventListener('resize', fitAll)
  }, [fitAll])

  const submit = async (code: string) => {
    try {
      const r = await fetch('/api/tableau-bord', { headers: { 'x-dashboard-pin': code }, cache: 'no-store' })
      if (r.ok) {
        savedPin.current = code
        try { sessionStorage.setItem('tb_pin', code) } catch { /* noop */ }
        setAuthed(true); setPin('')
      } else { setPinErr(true); setPin('') }
    } catch { setPinErr(true); setPin('') }
  }

  if (!authed) {
    return (
      <div className="bl-pin">
        <p className="bl-pintitle">Journal de bord</p>
        <p className={`bl-pindots ${pinErr ? 'err' : ''}`}>{'•'.repeat(pin.length).padEnd(6, '·')}</p>
        <div className="bl-pad">
          {['1','2','3','4','5','6','7','8','9','','0','←'].map((d, i) => (
            <button key={i} disabled={!d}
              onClick={() => {
                setPinErr(false)
                if (d === '←') { setPin(p => p.slice(0, -1)); return }
                setPin(p => { const n = (p + d).slice(0, 6); if (n.length === 6) void submit(n); return n })
              }}>{d}</button>
          ))}
        </div>
        <style jsx global>{CSS}</style>
      </div>
    )
  }

  const ops = tb?.ops || {}
  const fa  = tb?.facturation || {}
  const enCours: any[] = tb?.enCours || []
  const anomalies = log?.anomalies || []
  const jour: any[] = (tb?.chauffeurs?.jour || []).slice().sort((a: any, b: any) => b.total - a.total).slice(0, 5)
  const rythme = log?.rythme || []
  const heure  = log?.heureBxl ?? new Date().getHours()

  return (
    <div className="bl">
      {/* ── Bandeau : les chiffres du jour ──────────────────────────── */}
      <div className="bl-kpis">
        <Kpi label="À facturer" val={ops.aFacturer} color="#E11D2E" tint="#FFE6E9" sub={`${ops.factureesJour ?? 0} parties aujourd’hui`} />
        <Kpi label="Terminées"  val={ops.termineesJour} color="#0B7F55" tint="#DCF3EA">
          <Trend rythme={rythme} heure={heure} />
        </Kpi>
        <Kpi label="Facturées"  val={ops.factureesJour} color="#1B57C9" tint="#E2EAFB" />
        <Kpi label="Délai médian à facturer" txt={dur(fa.dureeMedHorsTouringMin)} color="#7A3BD6" tint="#EEE6FC"
             sub={`Touring ${dur(fa.dureeMedTouringMin)} — attente du BKO`} />
        <Kpi label="Touring · BKO à valider" txt={`${tb?.sources?.touring?.bko ?? '—'} / ${tb?.sources?.touring?.total ?? '—'}`} color="#0F7B6C" tint="#DBF1EE" />
        <Kpi label="Allianz · à clôturer"    txt={`${tb?.sources?.allianz?.cloture ?? '—'} / ${tb?.sources?.allianz?.total ?? '—'}`} color="#C2700A" tint="#FCEFD9" />
        <span className="bl-clockbox">
          <span className="bl-clock">{new Date(nowMs).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          {stale
            ? <span className="bl-stale">données figées</span>
            : <span className="bl-live"><i /> en direct</span>}
        </span>
      </div>

      <div className="bl-cols">
        {/* ── Missions en cours ────────────────────────────────────── */}
        <section className="bl-card" style={{ ['--hc' as any]: '#1B57C9' }}>
          <h2>Missions en cours <span>{enCours.length}</span></h2>
          <div className="bl-missions" ref={missionsRef}>
            {enCours.length === 0 && <p className="bl-empty">Aucune mission en cours.</p>}
            {enCours.map((m: any) => {
              const si = stepIndex(m.steps)
              const st = STEPS[si] || STEPS[0]
              const src = m.sourceHex ? { color: m.sourceHex, soft: m.sourceHex + '1A' } : NEUTRE
              return (
                <article key={m.id} className="bl-mission"
                  style={{
                    ['--sc' as any]: src.color, ['--scs' as any]: src.soft,
                    ['--ec' as any]: st.color, ['--ecs' as any]: st.soft,
                    ['--prog' as any]: `${Math.round(si / (STEPS.length - 1) * 100)}%`,
                  }}>
                  <span className="bl-plate">{m.plate || `#${m.missionNumber}`}</span>
                  <div className="bl-mid">
                    <div className="bl-veh">{m.vehicle || '—'}</div>
                    <div className="bl-meta">
                      <span className="bl-who"><span className="bl-face">{initials(m.driver)}</span>{m.driver}</span>
                      {m.city && <span className="bl-town">{m.city}</span>}
                      {m.sourceLabel && <span className="bl-tag">{m.sourceLabel}</span>}
                    </div>
                  </div>
                  <div className="bl-right">
                    <span className="bl-step">{m.statusLabel}</span>
                    <span className={`bl-timer ${timerTone(m.since, nowMs)}`}>{depuis(m.since, nowMs)}</span>
                  </div>
                  <div className="bl-rail" style={{ gridTemplateColumns: `repeat(${STEPS.length}, 1fr)` }}>
                    {STEPS.map((s, i) => {
                      const at = stepAt(m.steps, s.key)
                      const cls = i < si ? 'done' : i === si ? 'now' : 'todo'
                      return (
                        <span key={s.key} className={`bl-leg ${cls}`} style={{ ['--c' as any]: s.color, ['--cs' as any]: s.soft }}>
                          <span className="bl-bar" />
                          <span className="bl-lb">{s.label}</span>
                          <span className="bl-at">{at ? hm(at) : '·'}</span>
                        </span>
                      )
                    })}
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        {/* ── Colonne de droite : ce qui cloche, puis le tempo du jour ── */}
        <div className="bl-side">
          <section className="bl-card bl-grow" style={{ ['--hc' as any]: '#C61D22' }}>
            <h2>À regarder <span className={anomalies.length ? 'warn' : ''}>{anomalies.length}</span></h2>
            <div className="bl-scroll">
              {anomalies.length === 0 && <p className="bl-empty">Rien à signaler sur les dernières 24 h.</p>}
              {anomalies.map((a, i) => (
                <div key={i} className={`bl-ano ${a.level}`}>
                  <p className="bl-anot">{a.titre}</p>
                  <p className="bl-anod">{a.detail}</p>
                  <p className="bl-anoh">
                    depuis {age(a.at, nowMs)}
                    {a.missionId && <a className="bl-open" href={`/mission/${a.missionId}`} target="_blank" rel="noreferrer">Ouvrir la fiche</a>}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="bl-card" style={{ ['--hc' as any]: '#C2700A' }}>
            <h2>Chauffeurs aujourd’hui</h2>
            <div className="bl-podium">
              {jour.length === 0 && <p className="bl-empty">Aucune mission clôturée.</p>}
              {jour.map((d: any, i: number) => (
                <div key={d.driver} className="bl-prow" style={{ ['--pc' as any]: PODIUM[i] || NEUTRE.color }}>
                  <span className="bl-rank">{i + 1}</span>
                  <span>
                    <span className="bl-pname">{d.driver}</span>
                    <span className="bl-pbar" style={{ width: `${Math.round(d.total / Math.max(1, jour[0].total) * 100)}%` }} />
                  </span>
                  <span className="bl-pnum">{d.total}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      {/* ── Journal : deux lignes visibles, le reste au scroll ───────── */}
      <section className="bl-card bl-feed" style={{ ['--hc' as any]: '#7A8AA0' }}>
        <h2>Journal <span>24 dernières heures</span></h2>
        <div className="bl-scroll" ref={feedRef}>
          {(log?.events || []).map((e, i) => (
            <p key={i} className={`bl-ev ${e.ton}`}>
              <span className="bl-evh">{hm(e.at)}</span>
              <span className="bl-evi">{ICONS[e.action] || '•'}</span>
              <span className="bl-evt">{e.text}</span>
            </p>
          ))}
          {(!log?.events || log.events.length === 0) && <p className="bl-empty">Aucun mouvement.</p>}
        </div>
      </section>

      <style jsx global>{CSS}</style>
    </div>
  )
}

function initials(n: string | null) {
  return String(n || '—').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}
function timerTone(since: string | null, nowMs: number) {
  if (!since) return ''
  const min = (nowMs - Date.parse(since)) / 60000
  return min >= 120 ? 'red' : min >= 60 ? 'amber' : ''
}

function Kpi({ label, val, txt, sub, color, tint, children }:
  { label: string; val?: number; txt?: string; sub?: string; color: string; tint: string; children?: React.ReactNode }) {
  return (
    <span className="bl-kpi" style={{ ['--kc' as any]: color, ['--kcs' as any]: tint }}>
      <span className="bl-kpil">{label}</span>
      <b className="bl-kpiv">{txt ?? (val ?? '—')}</b>
      {sub && <span className="bl-kpis2">{sub}</span>}
      {children}
    </span>
  )
}

/** Clôtures par heure, sous le nombre de missions terminées : la matinée se lit
 *  d'un coup d'œil, sans qu'un bloc entier lui soit consacré (Olivier 21/09). */
function Trend({ rythme, heure }: { rythme: { h: number; n: number }[]; heure: number }) {
  const slice = rythme.filter(r => r.h >= 5 && r.h <= 21)
  const max = Math.max(1, ...slice.map(r => r.n))
  return (
    <span className="bl-trend" title="Clôtures par heure, de 5 h à 21 h">
      {slice.map(r => (
        <i key={r.h} style={{
          height: `${Math.max(2, r.n / max * 15)}px`,
          background: r.h === heure ? '#E11D2E' : r.h < heure ? '#0B7F55' : '#D3DDE8',
        }} />
      ))}
    </span>
  )
}

const CSS = `
/* Écran clair : la page reste allumée toute la journée dans un bureau éclairé —
   le sombre y est moins lisible et fatigue plus vite. Olivier 2026-08-14. */
:root { color-scheme: light; }
body { margin:0; background:#E6EBF2; color:#111820;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; -webkit-font-smoothing:antialiased; }
.bl { display:flex; flex-direction:column; gap:10px; height:100vh; padding:10px 12px; box-sizing:border-box; }
.bl *, .bl *::before, .bl *::after { box-sizing:border-box; }

/* ── bandeau ── */
.bl-kpis { display:flex; align-items:stretch; background:#fff; border:1px solid #D3DDE8;
  border-radius:14px; overflow:hidden; box-shadow:0 6px 18px -12px rgba(17,24,32,.4); }
.bl-kpi { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; padding:8px 14px 9px;
  border-top:3px solid var(--kc); background:linear-gradient(180deg,var(--kcs) 0%,transparent 46%); }
.bl-kpi + .bl-kpi { border-left:1px solid #E6ECF3; }
.bl-kpil { font-size:11px; color:#647385; text-transform:uppercase; letter-spacing:.08em; font-weight:700;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.bl-kpiv { font-size:clamp(20px,1.7vw,32px); font-weight:800; line-height:1; color:var(--kc);
  font-variant-numeric:tabular-nums; letter-spacing:-.02em; }
.bl-kpis2 { font-size:11px; color:#96A4B4; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.bl-trend { display:flex; align-items:flex-end; gap:2px; height:15px; margin-top:3px; }
.bl-trend i { width:5px; border-radius:1px; display:block; }
.bl-clockbox { padding:8px 16px; display:flex; flex-direction:column; justify-content:center; align-items:flex-end;
  gap:3px; border-left:1px solid #E6ECF3; background:#F3F6FA; }
.bl-clock { font-size:clamp(20px,1.7vw,32px); font-weight:800; font-variant-numeric:tabular-nums; line-height:1; }
.bl-live { display:flex; align-items:center; gap:6px; font-size:11px; font-weight:700; color:#0B7F55;
  text-transform:uppercase; letter-spacing:.08em; }
.bl-live i { width:8px; height:8px; border-radius:50%; background:#0B7F55; animation:bl-blip 2s ease-in-out infinite; }
@keyframes bl-blip { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.3;transform:scale(.8)} }
.bl-stale { font-size:11px; font-weight:700; color:#C2410C; text-transform:uppercase; letter-spacing:.08em; }

/* ── colonnes ── */
.bl-cols { display:grid; grid-template-columns:2.9fr 1fr; gap:10px; flex:1; min-height:0; }
.bl-card { background:#fff; border:1px solid #D3DDE8; border-radius:14px;
  display:flex; flex-direction:column; min-height:0; overflow:hidden; box-shadow:0 6px 18px -12px rgba(17,24,32,.4); }
.bl-card h2 { margin:0; padding:9px 14px; font-size:11px; text-transform:uppercase; letter-spacing:.1em;
  color:#647385; border-bottom:1px solid #E6ECF3; display:flex; gap:8px; align-items:center; font-weight:800; flex:0 0 auto; }
.bl-card h2::before { content:""; width:7px; height:7px; border-radius:50%; background:var(--hc,#1B57C9); flex:0 0 auto; }
.bl-card h2 span { background:#F3F6FA; color:#39485A; border-radius:999px; padding:1px 8px; font-size:11px; }
.bl-card h2 span.warn { background:#FDE5E5; color:#C61D22; }
.bl-scroll { overflow-y:auto; flex:1; min-height:0; }
.bl-scroll::-webkit-scrollbar, .bl-missions::-webkit-scrollbar { width:7px; }
.bl-scroll::-webkit-scrollbar-thumb, .bl-missions::-webkit-scrollbar-thumb { background:#D3DDE8; border-radius:4px; }
.bl-empty { color:#96A4B4; font-size:13px; padding:14px; margin:0; }
.bl-side { display:flex; flex-direction:column; gap:10px; min-height:0; }
.bl-side .bl-card { flex:0 0 auto; }
.bl-side .bl-grow { flex:1 1 auto; min-height:0; }

/* ── missions : tout doit tenir, donc tout est en em ── */
.bl-missions { overflow-y:auto; flex:1; min-height:0; font-size:15px; }
.bl-mission { position:relative; display:grid; grid-template-columns:auto 1fr auto; gap:.55em .8em;
  align-items:center; padding:.5em .9em .7em .65em; border-bottom:1px solid #E6ECF3;
  border-left:4px solid var(--sc); background:linear-gradient(90deg,var(--scs) 0%,transparent 34%); }
.bl-mission:last-child { border-bottom:0; }
.bl-mission::after { content:""; position:absolute; left:0; bottom:0; height:3px; width:var(--prog,0%);
  background:var(--ec); transition:width 1s cubic-bezier(.2,.9,.3,1); }
.bl-plate { font-family:ui-monospace,'SF Mono',Menlo,monospace; font-weight:600; font-size:1em; letter-spacing:.04em;
  background:#F3F6FA; border:1px solid #D3DDE8; border-radius:.32em; padding:.16em .52em; white-space:nowrap; }
.bl-mid { min-width:0; }
.bl-veh { font-size:1em; font-weight:600; line-height:1.25; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.bl-meta { display:flex; align-items:center; gap:.5em; margin-top:.16em; flex-wrap:wrap; }
.bl-who { display:flex; align-items:center; gap:.4em; font-size:.82em; color:#39485A; font-weight:600; }
.bl-face { font-size:.62em; width:1.9em; height:1.9em; border-radius:50%; background:var(--sc); color:#fff;
  font-weight:800; display:grid; place-items:center; flex:0 0 auto; }
.bl-town { font-size:.7em; color:#96A4B4; font-weight:600; text-transform:uppercase; letter-spacing:.06em; }
.bl-tag { font-size:.7em; font-weight:700; padding:.1em .6em; border-radius:999px;
  background:var(--scs); color:var(--sc); border:1px solid var(--sc); white-space:nowrap; }
.bl-right { text-align:right; display:flex; flex-direction:column; align-items:flex-end; gap:.18em; }
.bl-timer { font-family:ui-monospace,'SF Mono',Menlo,monospace; font-size:1em; font-weight:600;
  font-variant-numeric:tabular-nums; color:#647385; }
.bl-timer.amber { color:#B4680A; } .bl-timer.red { color:#C61D22; }
.bl-step { font-size:.7em; font-weight:700; color:var(--ec); text-transform:uppercase; letter-spacing:.05em;
  background:var(--ecs); border-radius:999px; padding:.15em .6em; white-space:nowrap; }
.bl-rail { grid-column:1/-1; display:grid; gap:.25em; margin-top:.05em; }
.bl-leg { min-width:0; }
.bl-bar { display:block; height:.46em; border-radius:.23em; background:#E6ECF3; position:relative; overflow:hidden; }
.bl-leg.done .bl-bar { background:var(--c); }
.bl-leg.now .bl-bar { background:var(--cs); box-shadow:inset 0 0 0 1px var(--c); }
.bl-leg.now .bl-bar::after { content:""; position:absolute; top:0; bottom:0; left:0; width:48%; border-radius:.23em;
  background:var(--c); box-shadow:0 0 9px var(--c); animation:bl-slide 1.25s linear infinite; }
@keyframes bl-slide { 0%{transform:translateX(-105%)} 100%{transform:translateX(215%)} }
.bl-lb { display:block; font-size:.6em; letter-spacing:.05em; text-transform:uppercase; font-weight:700;
  color:#96A4B4; margin-top:.3em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.bl-at { display:block; font-family:ui-monospace,'SF Mono',Menlo,monospace; font-size:.64em; font-weight:600;
  color:#96A4B4; line-height:1.2; }
.bl-leg.done .bl-lb, .bl-leg.now .bl-lb { color:var(--c); }
.bl-leg.done .bl-at { color:#39485A; }
.bl-leg.now .bl-at { color:var(--c); }
.bl-leg.todo .bl-at { color:transparent; }

/* ── anomalies ── */
.bl-ano { padding:9px 14px 10px; border-bottom:1px solid #E6ECF3; border-left:4px solid transparent; }
.bl-ano.rouge { border-left-color:#C61D22; background:#FDE5E5; }
.bl-ano.ambre { border-left-color:#B4680A; background:#FDEFD9; }
.bl-anot { margin:0; font-weight:800; font-size:13.5px; }
.bl-ano.rouge .bl-anot { color:#C61D22; } .bl-ano.ambre .bl-anot { color:#B4680A; }
.bl-anod { margin:3px 0 0; color:#39485A; font-size:12.5px; line-height:1.4; }
.bl-anoh { margin:5px 0 0; color:#647385; font-size:11px; font-weight:600; display:flex; align-items:center; gap:8px; }
.bl-open { margin-left:auto; font-weight:700; color:#1B57C9; border:1px solid #1B57C9; border-radius:7px;
  padding:2px 9px; background:#fff; text-decoration:none; }
.bl-open:hover { background:#1B57C9; color:#fff; }

/* ── chauffeurs ── */
.bl-podium { padding:5px 0; display:flex; flex-direction:column; }
.bl-prow { display:grid; grid-template-columns:18px 1fr auto; gap:9px; align-items:center; padding:5px 14px; }
.bl-rank { font-size:13px; font-weight:800; color:var(--pc); text-align:right; }
.bl-pname { font-size:13px; font-weight:600; }
.bl-pbar { display:block; height:6px; border-radius:3px; background:var(--pc); margin-top:4px; transition:width .9s ease; }
.bl-pnum { font-size:15px; font-weight:800; font-variant-numeric:tabular-nums; color:var(--pc); }

/* ── journal : deux lignes visibles, le reste au scroll ── */
.bl-feed { flex:0 0 auto; }
.bl-feed .bl-scroll { flex:0 0 auto; }
.bl-ev { display:grid; grid-template-columns:48px 20px 1fr; gap:10px; align-items:baseline; margin:0;
  padding:6px 16px; border-bottom:1px solid #EEF2F7; font-size:14.5px; line-height:1.45;
  border-left:3px solid transparent; }
.bl-ev.ok { border-left-color:#0B7F55; }
.bl-ev.ok .bl-evt { color:#0B7F55; font-weight:600; }
.bl-ev.info { border-left-color:#1B57C9; }
.bl-ev.alerte { background:#FDE5E5; border-left-color:#C61D22; }
.bl-ev.alerte .bl-evt { color:#C61D22; font-weight:600; }
.bl-evh { color:#96A4B4; font-variant-numeric:tabular-nums; font-size:12.5px; font-weight:700; }
.bl-evt { color:#111820; }

/* ── PIN ── */
.bl-pin { height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px; }
.bl-pintitle { font-size:20px; font-weight:800; margin:0; }
.bl-pindots { font-size:34px; letter-spacing:.35em; margin:0; color:#647385; }
.bl-pindots.err { color:#C61D22; }
.bl-pad { display:grid; grid-template-columns:repeat(3,86px); gap:12px; }
.bl-pad button { height:74px; font-size:26px; font-weight:800; border-radius:14px;
  background:#fff; border:1px solid #D3DDE8; color:#111820; cursor:pointer; }
.bl-pad button:disabled { opacity:0; cursor:default; }
.bl-pad button:active { background:#F3F6FA; }

@media (prefers-reduced-motion:reduce) { .bl * { animation:none !important; transition:none !important; } }
@media (max-width:1150px) { .bl-cols { grid-template-columns:1fr; } }
`
