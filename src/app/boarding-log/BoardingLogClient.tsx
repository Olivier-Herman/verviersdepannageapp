'use client'
// src/app/boarding-log/BoardingLogClient.tsx
//
// JOURNAL DE BORD — écran à laisser allumé (Olivier 2026-08-14).
//
// « Je peux l'afficher en permanence devant moi et je vois toutes tes infos en
// direct plutôt que de l'avoir perdu dans nos échanges. » D'où trois zones, de
// la plus petite à la plus grande :
//   · une ligne de chiffres, discrète, qui ne bouge presque pas ;
//   · les missions en cours ;
//   · le journal en direct, avec les ANOMALIES d'abord.
//
// Rien ne clignote et rien ne défile tout seul : un écran mural qui bouge sans
// raison finit par ne plus être regardé.

import { useCallback, useEffect, useRef, useState } from 'react'

const POLL_MS = 15000

interface Ev { at: string; action: string; text: string; ton: 'info' | 'ok' | 'alerte'; notes: string; number: number | null; plate: string | null; source: string | null; driver: string | null; repeats?: number }
interface Ano { level: 'rouge' | 'ambre'; titre: string; detail: string; at: string }

const ICONS: Record<string, string> = {
  accept: '🤝', on_way: '🚚', on_site: '📍', load_vehicle: '⬆️', park: '🅿️',
  completed: '🏁', flux2_closed: '✅', touring_closed: '🅃', vab_closed: '🅅',
  axa_closed: '🅰️', touring_synced: '🅃', vab_synced: '🅅', kaze_synced: '🅺',
  invoiced: '💶', invoice_autoposted: '💶', request_relivraison: '🔁', kaze_rel_merged: '🔗',
  force_status_to_invoice: '✋', force_status_parked: '✋', force_status_completed: '✋',
}

const hm = (s: string) => new Date(s).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })
const dur = (min: number | null | undefined) => min == null ? '—' : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
const depuis = (iso: string | null) => {
  if (!iso) return ''
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

export default function BoardingLogClient() {
  const [authed, setAuthed] = useState(false)
  const [pin, setPin]       = useState('')
  const [pinErr, setPinErr] = useState(false)
  const [tb, setTb]         = useState<any>(null)
  const [log, setLog]       = useState<{ events: Ev[]; anomalies: Ano[] } | null>(null)
  const [stale, setStale]   = useState(false)
  const savedPin = useRef('')

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
    const t = setInterval(fetchAll, POLL_MS)
    const s = setInterval(() => setStale(true), POLL_MS * 4)
    return () => { clearInterval(t); clearInterval(s) }
  }, [authed, fetchAll])

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

  return (
    <div className="bl">
      {/* ── Ligne de chiffres, volontairement petite ─────────────────── */}
      <div className="bl-kpis">
        <Kpi label="À facturer"        val={ops.aFacturer} />
        <Kpi label="Terminées aujourd’hui" val={ops.termineesJour} />
        <Kpi label="Facturées aujourd’hui" val={ops.factureesJour} />
        <Kpi label="Délai médian à facturer" txt={dur(fa.dureeMedMin)} />
        <Kpi label="Touring · BKO à valider"  txt={`${tb?.sources?.touring?.bko ?? '—'} / ${tb?.sources?.touring?.total ?? '—'}`} />
        <Kpi label="Allianz · à clôturer"     txt={`${tb?.sources?.allianz?.cloture ?? '—'} / ${tb?.sources?.allianz?.total ?? '—'}`} />
        <span className="bl-clock">
          {new Date().toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })}
          {stale && <span className="bl-stale"> · données figées</span>}
        </span>
      </div>

      <div className="bl-cols">
        {/* ── Missions en cours ───────────────────────────────────────── */}
        <section className="bl-card">
          <h2>Missions en cours <span>{enCours.length}</span></h2>
          <div className="bl-scroll">
            <table className="bl-tbl">
              <tbody>
                {enCours.length === 0 && <tr><td className="bl-empty">Aucune mission en cours.</td></tr>}
                {enCours.map((m: any) => (
                  <tr key={m.id}>
                    <td className="bl-num">#{m.missionNumber}</td>
                    <td className="bl-plate">{m.plate}</td>
                    <td className="bl-veh">{m.vehicle}<span>{m.city}</span></td>
                    <td className="bl-drv">{m.driver}</td>
                    <td className="bl-st">{m.statusLabel}</td>
                    <td className="bl-since">{depuis(m.since)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Anomalies ───────────────────────────────────────────────── */}
        <section className="bl-card">
          <h2>À regarder <span className={log?.anomalies?.length ? 'warn' : ''}>{log?.anomalies?.length ?? 0}</span></h2>
          <div className="bl-scroll">
            {(!log?.anomalies || log.anomalies.length === 0) && (
              <p className="bl-empty">Rien à signaler sur les dernières 24 h.</p>
            )}
            {(log?.anomalies || []).map((a, i) => (
              <div key={i} className={`bl-ano ${a.level}`}>
                <p className="bl-anot">{a.titre}</p>
                <p className="bl-anod">{a.detail}</p>
                <p className="bl-anoh">{hm(a.at)}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ── Journal en direct ─────────────────────────────────────────── */}
      <section className="bl-card bl-feed">
        <h2>Journal — 24 dernières heures</h2>
        <div className="bl-scroll">
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

function Kpi({ label, val, txt }: { label: string; val?: number; txt?: string }) {
  return (
    <span className="bl-kpi">
      <span className="bl-kpil">{label}</span>
      <span className="bl-kpiv">{txt ?? (val ?? '—')}</span>
    </span>
  )
}

const CSS = `
/* Écran clair : la page reste allumée toute la journée dans un bureau éclairé —
   le sombre y est moins lisible et fatigue plus vite. Olivier 2026-08-14. */
:root { color-scheme: light; }
body { margin:0; background:#F4F1EC; color:#1F1A17;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; -webkit-font-smoothing:antialiased; }
.bl { display:flex; flex-direction:column; gap:10px; height:100vh; padding:10px 12px; box-sizing:border-box; }

.bl-kpis { display:flex; align-items:center; gap:20px; flex-wrap:wrap;
  padding:7px 14px; background:#fff; border:1px solid #E3DDD6; border-radius:10px; }
.bl-kpi { display:flex; align-items:baseline; gap:7px; }
.bl-kpil { font-size:11px; color:#8A7F74; text-transform:uppercase; letter-spacing:.06em; font-weight:700; }
.bl-kpiv { font-size:16px; font-weight:800; font-variant-numeric:tabular-nums; color:#1F1A17; }
.bl-clock { margin-left:auto; font-size:13px; font-weight:800; color:#8A7F74; font-variant-numeric:tabular-nums; }
.bl-stale { color:#C2410C; font-weight:700; }

.bl-cols { display:grid; grid-template-columns:1.3fr 1fr; gap:10px; min-height:0; flex:0 0 38%; }
.bl-card { background:#fff; border:1px solid #E3DDD6; border-radius:12px;
  display:flex; flex-direction:column; min-height:0; overflow:hidden; }
.bl-card h2 { margin:0; padding:9px 14px; font-size:12px; text-transform:uppercase; letter-spacing:.07em;
  color:#6B625A; border-bottom:1px solid #EDE8E2; display:flex; gap:8px; align-items:center; font-weight:800; }
.bl-card h2 span { background:#F1EDE7; color:#4A413C; border-radius:999px; padding:1px 8px; font-size:11px; }
.bl-card h2 span.warn { background:#FEE2E2; color:#B91C1C; }
.bl-scroll { overflow-y:auto; flex:1; min-height:0; }
.bl-empty { color:#A89E92; font-size:13px; padding:14px; margin:0; }

.bl-tbl { width:100%; border-collapse:collapse; font-size:13.5px; }
.bl-tbl td { padding:7px 10px; border-bottom:1px solid #F1EDE7; vertical-align:middle; white-space:nowrap; }
.bl-num { color:#A89E92; font-variant-numeric:tabular-nums; }
.bl-plate { font-weight:800; letter-spacing:.03em; }
.bl-veh { color:#6B625A; white-space:normal; }
.bl-veh span { display:block; color:#A89E92; font-size:11.5px; }
.bl-drv { color:#1F1A17; font-weight:600; }
.bl-st { color:#1D4ED8; font-weight:700; font-size:12px; }
.bl-since { color:#A89E92; text-align:right; font-variant-numeric:tabular-nums; }

.bl-ano { padding:9px 14px; border-bottom:1px solid #F1EDE7; border-left:3px solid transparent; }
.bl-ano.rouge { border-left-color:#DC2626; background:#FEF2F2; }
.bl-ano.ambre { border-left-color:#D97706; background:#FFFBEB; }
.bl-anot { margin:0; font-weight:800; font-size:13.5px; color:#1F1A17; }
.bl-anod { margin:2px 0 0; color:#6B625A; font-size:12.5px; }
.bl-anoh { margin:2px 0 0; color:#A89E92; font-size:11px; font-variant-numeric:tabular-nums; }

/* Le journal : des phrases, pas un tableau. */
.bl-feed { flex:1; min-height:0; }
.bl-ev { display:flex; gap:10px; align-items:baseline; margin:0;
  padding:6px 16px; border-bottom:1px solid #F5F1EC; font-size:14.5px; line-height:1.45; }
.bl-ev.ok     .bl-evt { color:#15803D; }
.bl-ev.alerte { background:#FEF2F2; }
.bl-ev.alerte .bl-evt { color:#B91C1C; font-weight:600; }
.bl-evh { color:#A89E92; font-variant-numeric:tabular-nums; font-size:12.5px; flex:0 0 42px; font-weight:700; }
.bl-evi { flex:0 0 20px; }
.bl-evt { color:#1F1A17; }

.bl-pin { height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px; }
.bl-pintitle { font-size:20px; font-weight:800; margin:0; }
.bl-pindots { font-size:34px; letter-spacing:.35em; margin:0; color:#8A7F74; }
.bl-pindots.err { color:#DC2626; }
.bl-pad { display:grid; grid-template-columns:repeat(3,86px); gap:12px; }
.bl-pad button { height:74px; font-size:26px; font-weight:800; border-radius:14px;
  background:#fff; border:1px solid #E3DDD6; color:#1F1A17; cursor:pointer; }
.bl-pad button:disabled { opacity:0; cursor:default; }
.bl-pad button:active { background:#F1EDE7; }

@media (max-width:1100px) { .bl-cols { grid-template-columns:1fr; flex:0 0 auto; } }
`
