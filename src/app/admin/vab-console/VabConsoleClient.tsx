'use client'

// Console VAB — pilotage pas-à-pas d'une mission VAB Comet (clôture).
// ⚠️ Chaque action est un postback OutSystems RÉEL et IRRÉVERSIBLE côté VAB.
// Charge l'état, liste les cibles exécutables + champs saisissables, exécute une
// action et affiche le résultat (nouveaux boutons + message).

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

interface Dump {
  ok: boolean; error?: string; message?: string | null; status?: number
  buttonTexts?: string[]
  actions?: Array<{ label: string; target: string | null; arg: string; tag: string; name?: string; id?: string }>
  postbackTargets?: string[]
  buttons?: Array<{ text: string; id: string | null; name: string | null; target: string | null; onclick: string; href: string; tag: string }>
  inputs?: Array<{ name: string; type: string; id: string | null; placeholder: string | null; value: string }>
  pageText?: string
}
interface Mission { missionNumber: string; detailHref: string; detail: any; dump: Dump }
interface Field { name: string; value: string }

export default function VabConsoleClient() {
  const [mission, setMission] = useState<Mission | null>(null)
  const [count, setCount]     = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(false)
  const [err, setErr]         = useState<string | null>(null)
  const [fields, setFields]   = useState<Field[]>([])
  const [custom, setCustom]   = useState('')
  const [log, setLog]         = useState<Array<{ t: string; target: string; status?: number; message?: string | null }>>([])

  const loadState = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const r = await fetch('/api/admin/vab/state', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Erreur')
      setCount(j.count)
      setMission(j.missions?.[0] || null)
      // Pré-remplit les champs saisissables détectés (vides).
      const inp = j.missions?.[0]?.dump?.inputs || []
      setFields(inp.map((i: any) => ({ name: i.name, value: '' })))
    } catch (e: any) { setErr(e?.message || 'Erreur') } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadState() }, [loadState])

  const execute = async (target: string) => {
    if (!mission) return
    const extra = Object.fromEntries(fields.filter(f => f.name && f.value !== '').map(f => [f.name, f.value]))
    const nFields = Object.keys(extra).length
    if (!window.confirm(`⚠️ ACTION IRRÉVERSIBLE sur VAB\n\nCible : ${target}\nChamps envoyés : ${nFields}\n\nConfirmer l'exécution ?`)) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/admin/vab/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ detailHref: mission.detailHref, eventTarget: target, extraFields: extra }),
      })
      const j: Dump = await r.json()
      setLog(prev => [{ t: new Date().toLocaleTimeString('fr-BE'), target, status: j.status, message: j.message ?? (j.ok ? '(ok)' : j.error) }, ...prev])
      if (!r.ok || !j.ok) { setErr(j.error || `Échec (status ${j.status ?? '?'})`) }
      // Met à jour l'état affiché avec la page résultat (nouveaux boutons).
      setMission(m => m ? { ...m, dump: j } : m)
      const inp = j.inputs || []
      setFields(inp.map(i => ({ name: i.name, value: '' })))
    } catch (e: any) { setErr(e?.message || 'Erreur réseau') } finally { setBusy(false) }
  }

  const d = mission?.dump
  const dt = mission?.detail
  // Cibles exécutables mergées (actions à target connu + name des boutons + postbackTargets).
  const targets = Array.from(new Set([
    ...(d?.actions || []).map(a => a.target).filter(Boolean) as string[],
    ...(d?.buttons || []).map(b => b.target).filter(Boolean) as string[],
    ...(d?.postbackTargets || []),
  ]))
  const labelFor = (t: string) =>
    (d?.actions || []).find(a => a.target === t)?.label
    || (d?.buttons || []).find(b => b.target === t)?.text || ''

  return (
    <div className="min-h-screen bg-surface max-w-4xl mx-auto flex flex-col">
      <div className="bg-surface-2 border-b border-app px-5 pt-12 pb-4">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="w-10 h-10 flex items-center justify-center bg-surface-hover rounded-xl text-ink text-lg">←</Link>
          <div className="flex-1">
            <h1 className="text-ink font-bold text-lg">🛠️ Console VAB</h1>
            <p className="text-ink-muted text-xs">Pilotage pas-à-pas d'une mission VAB Comet. ⚠️ Chaque action est réelle et irréversible côté VAB.</p>
          </div>
          <button onClick={loadState} disabled={loading || busy} className="px-3 py-2 bg-surface border border-app rounded-xl text-sm text-ink-secondary disabled:opacity-50">↻ Recharger</button>
        </div>
      </div>

      <div className="flex-1 px-5 py-5 space-y-4">
        {err && <p className="text-critical text-sm bg-critical-soft border border-critical rounded-xl px-3 py-2">⚠️ {err}</p>}
        {loading ? <p className="text-ink-muted text-sm">Chargement de la mission VAB…</p>
        : !mission ? <p className="text-ink-muted text-sm italic">Aucune mission VAB disponible {count != null ? `(${count})` : ''}.</p>
        : (
          <>
            {/* Mission */}
            <div className="bg-surface-2 border border-app rounded-2xl p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-bold text-ink bg-surface border border-app rounded-lg px-2 py-0.5">{dt?.vehiclePlate || '—'}</span>
                <span className="text-sm text-ink">{[dt?.vehicleBrand, dt?.vehicleModel].filter(Boolean).join(' ')}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-info-soft text-info">{dt?.taskType || '—'}</span>
                <span className="text-xs text-ink-muted">n° {mission.missionNumber} · dossier {dt?.dossierNumber || '—'}</span>
              </div>
              <div className="text-xs text-ink-muted mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
                <div>De : {dt?.fromName} — {dt?.fromStreet}, {dt?.fromZip} {dt?.fromCity}</div>
                <div>Vers : {dt?.toName} — {dt?.toStreet}, {dt?.toZip} {dt?.toCity}</div>
              </div>
            </div>

            {/* Message / feedback OutSystems (on ignore le placeholder « Loading ») */}
            {d?.message && d.message.trim() !== 'Loading' && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-3 py-2 text-sm">💬 {d.message}</div>}

            {/* Diagnostic : câblage brut des boutons (pour identifier Accepter/Contrat) */}
            {d?.buttons?.length ? (
              <details className="bg-surface border border-app rounded-2xl p-3">
                <summary className="text-sm font-semibold text-ink cursor-pointer">🔧 Câblage des boutons ({d.buttons.length})</summary>
                <div className="mt-2 space-y-1.5 max-h-72 overflow-y-auto">
                  {d.buttons.map((b, i) => (
                    <div key={i} className="text-xs border-b border-app pb-1.5">
                      <div className="flex items-center gap-2">
                        <b className="text-ink">{b.text || '(vide)'}</b>
                        <span className="text-ink-muted">&lt;{b.tag}&gt;</span>
                        {b.target && <button onClick={() => execute(b.target!)} disabled={busy} className="px-2 py-0.5 bg-brand text-white rounded text-[11px]">Exécuter</button>}
                      </div>
                      {b.target && <div className="font-mono text-emerald-700 break-all">target: {b.target}</div>}
                      {b.name && <div className="font-mono text-ink-secondary break-all">name: {b.name}</div>}
                      {b.id && <div className="font-mono text-ink-muted break-all">id: {b.id}</div>}
                      {b.onclick && <div className="font-mono text-ink-muted break-all">onclick: {b.onclick}</div>}
                      {b.href && b.href !== '#' && <div className="font-mono text-ink-muted break-all">href: {b.href}</div>}
                    </div>
                  ))}
                </div>
              </details>
            ) : null}

            {/* Contenu de la page / modale (ex. Contrat : REM/VR + jours max) */}
            {d?.pageText && (
              <details className="bg-surface border border-app rounded-2xl p-3">
                <summary className="text-sm font-semibold text-ink cursor-pointer">📄 Contenu de la page / modale</summary>
                <pre className="text-xs text-ink-secondary whitespace-pre-wrap mt-2 max-h-72 overflow-y-auto">{d.pageText}</pre>
              </details>
            )}

            {/* Boutons visibles (ce que Franck voit sur VAB) */}
            {d?.buttonTexts?.length ? (
              <div className="text-xs text-ink-muted">Boutons visibles sur VAB : {d.buttonTexts.map(b => <span key={b} className="inline-block bg-surface border border-app rounded px-1.5 py-0.5 mr-1 mb-1">{b}</span>)}</div>
            ) : null}

            {/* Champs à envoyer (km, VIN, signature, codes…) */}
            <div className="bg-surface-2 border border-app rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-ink">Champs à envoyer avec l'action</h3>
                <button onClick={() => setFields(f => [...f, { name: '', value: '' }])} className="text-xs text-brand">＋ champ</button>
              </div>
              {fields.length === 0 && <p className="text-xs text-ink-muted italic">Aucun champ détecté. Ajoute-en si une étape en demande (km, VIN…).</p>}
              {fields.map((f, i) => (
                <div key={i} className="flex gap-2">
                  <input value={f.name} onChange={e => setFields(fs => fs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                    placeholder="name (OutSystems)" className="flex-1 px-2 py-1 bg-surface border border-app rounded-lg text-xs font-mono text-ink" />
                  <input value={f.value} onChange={e => setFields(fs => fs.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                    placeholder="valeur" className="flex-1 px-2 py-1 bg-surface border border-app rounded-lg text-xs text-ink" />
                </div>
              ))}
            </div>

            {/* Cibles exécutables */}
            <div className="bg-surface-2 border border-app rounded-2xl p-4 space-y-2">
              <h3 className="text-sm font-semibold text-ink">Cibles exécutables ({targets.length})</h3>
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {targets.map(t => (
                  <div key={t} className="flex items-center gap-2">
                    <button onClick={() => execute(t)} disabled={busy}
                      className="px-2.5 py-1 bg-brand text-white rounded-lg text-xs font-semibold disabled:opacity-50 shrink-0">Exécuter</button>
                    <span className="text-xs text-ink-secondary truncate" title={t}>{labelFor(t) && <b className="text-ink">{labelFor(t)} · </b>}{t}</span>
                  </div>
                ))}
              </div>
              {/* Cible manuelle */}
              <div className="flex gap-2 pt-2 border-t border-app">
                <input value={custom} onChange={e => setCustom(e.target.value)} placeholder="__EVENTTARGET manuel"
                  className="flex-1 px-2 py-1 bg-surface border border-app rounded-lg text-xs font-mono text-ink" />
                <button onClick={() => custom.trim() && execute(custom.trim())} disabled={busy || !custom.trim()}
                  className="px-3 py-1 bg-surface border border-app rounded-lg text-xs text-ink-secondary disabled:opacity-50">Exécuter</button>
              </div>
            </div>

            {/* Journal des actions */}
            {log.length > 0 && (
              <div className="bg-surface-2 border border-app rounded-2xl p-4">
                <h3 className="text-sm font-semibold text-ink mb-2">Journal</h3>
                <ul className="space-y-1 text-xs">
                  {log.map((l, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-ink-muted">{l.t}</span>
                      <span className="font-mono text-ink-secondary truncate flex-1" title={l.target}>{l.target}</span>
                      <span className={l.status && l.status < 400 ? 'text-emerald-600' : 'text-critical'}>{l.status}</span>
                      {l.message && <span className="text-ink-muted truncate max-w-[40%]">{l.message}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
