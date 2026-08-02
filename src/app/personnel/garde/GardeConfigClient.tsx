'use client'
// src/app/personnel/garde/GardeConfigClient.tsx — Paramétrage du planning de garde (RH).

import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { ShieldCheck, ArrowLeft, ChevronUp, ChevronDown, X, Plus, Save, Moon, Sun } from 'lucide-react'

export default function GardeConfigClient({ userRole, userName, userEmail, userModules }: {
  userRole: string; userName: string; userEmail: string; userModules: string[]
}) {
  const [cfg, setCfg] = useState<any>(null)
  const [drivers, setDrivers] = useState<any[]>([])
  const [msg, setMsg] = useState('')
  const [preview, setPreview] = useState<any[]>([])

  const nameOf = (id: string) => drivers.find(d => d.id === id)?.name || id
  const load = () => fetch('/api/garde/plan', { cache: 'no-store' }).then(r => r.json()).then(d => { setCfg(d.config); setDrivers(d.drivers || []) })
  useEffect(() => { load() }, [])

  const loadPreview = () => {
    const from = new Date(); const to = new Date(); to.setDate(to.getDate() + 27)
    const p = (d: Date) => d.toISOString().slice(0, 10)
    fetch(`/api/garde/plan?events=1&from=${p(from)}&to=${p(to)}`, { cache: 'no-store' }).then(r => r.json()).then(d => setPreview((d.days || []).filter((x: any) => x.date.slice(8) && new Date(x.date).getDay() === 1)))
  }

  const set = (k: string, v: any) => setCfg((c: any) => ({ ...c, [k]: v }))
  const addTo = (key: 'weekly' | 'wednesday', id: string) => { if (id && !cfg[key].includes(id)) set(key, [...cfg[key], id]) }
  const removeFrom = (key: 'weekly' | 'wednesday', id: string) => set(key, cfg[key].filter((x: string) => x !== id))
  const move = (key: 'weekly' | 'wednesday', i: number, dir: -1 | 1) => {
    const arr = [...cfg[key]]; const j = i + dir; if (j < 0 || j >= arr.length) return
    ;[arr[i], arr[j]] = [arr[j], arr[i]]; set(key, arr)
  }

  const save = async () => {
    setMsg('')
    const r = await fetch('/api/garde/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) })
    const j = await r.json()
    if (!r.ok) { setMsg('❌ ' + (j.error || 'Erreur')); return }
    setMsg('✅ Planning enregistré'); await load(); loadPreview()
  }

  if (!cfg) return <AppShell title="Garde" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}><div className="max-w-2xl mx-auto px-4 py-8 text-ink-muted">Chargement…</div></AppShell>

  const Rotation = ({ title, k, hint }: { title: string; k: 'weekly' | 'wednesday'; hint: string }) => (
    <div className="bg-surface border rounded-2xl p-5">
      <h2 className="font-semibold text-ink text-sm">{title}</h2>
      <p className="text-ink-muted text-xs mb-3">{hint}</p>
      <div className="flex flex-col gap-1.5 mb-3">
        {cfg[k].map((id: string, i: number) => (
          <div key={id} className="flex items-center gap-2 bg-surface-2 border rounded-lg px-3 py-2">
            <span className="text-ink-muted text-xs w-5">{i + 1}.</span>
            <span className="text-ink text-sm flex-1">{nameOf(id)}</span>
            <button onClick={() => move(k, i, -1)} disabled={i === 0} className="p-1 text-ink-muted hover:text-brand disabled:opacity-30"><ChevronUp size={14} /></button>
            <button onClick={() => move(k, i, 1)} disabled={i === cfg[k].length - 1} className="p-1 text-ink-muted hover:text-brand disabled:opacity-30"><ChevronDown size={14} /></button>
            <button onClick={() => removeFrom(k, id)} className="p-1 text-ink-muted hover:text-red-500"><X size={14} /></button>
          </div>
        ))}
        {!cfg[k].length && <p className="text-ink-muted text-sm italic">Aucun chauffeur dans cette rotation.</p>}
      </div>
      <select value="" onChange={e => addTo(k, e.target.value)} className="w-full bg-bg border rounded-lg px-3 py-2 text-sm text-ink">
        <option value="">+ Ajouter un chauffeur…</option>
        {drivers.filter(d => !cfg[k].includes(d.id)).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
    </div>
  )

  return (
    <AppShell title="Planning de garde" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center gap-3">
          <a href="/personnel" className="p-2 rounded-lg border text-ink-muted hover:text-brand"><ArrowLeft size={16} /></a>
          <div className="w-10 h-10 rounded-2xl bg-brand/10 text-brand flex items-center justify-center"><ShieldCheck size={20} /></div>
          <div className="flex-1"><h1 className="text-xl font-bold text-ink leading-tight">Planning de garde</h1>
            <p className="text-ink-muted text-xs">Rotations à tour de rôle, générées automatiquement chaque semaine.</p></div>
          <button onClick={save} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg bg-brand text-white hover:opacity-90"><Save size={15} /> Enregistrer</button>
        </div>
        {msg && <p className="text-sm">{msg}</p>}

        <div className="bg-surface border rounded-2xl p-5 grid sm:grid-cols-2 gap-4">
          <label className="block"><span className="text-ink-muted text-xs">Semaine de référence (un lundi)</span>
            <input type="date" value={cfg.anchor_monday} onChange={e => set('anchor_monday', e.target.value)} className="w-full mt-1 bg-bg border rounded-lg px-3 py-2 text-sm text-ink" />
            <span className="text-[11px] text-ink-muted">= la semaine où le 1er de chaque rotation est de garde.</span></label>
          <label className="block"><span className="text-ink-muted text-xs">Homme de nuit fixe (1er départ sauf mercredi)</span>
            <select value={cfg.night_fixed || ''} onChange={e => set('night_fixed', e.target.value || null)} className="w-full mt-1 bg-bg border rounded-lg px-3 py-2 text-sm text-ink">
              <option value="">— aucun —</option>
              {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select></label>
          <div className="sm:col-span-2 flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-1 text-ink-muted text-xs"><Sun size={13} /> Jour</div>
            <input type="time" value={cfg.day_start} onChange={e => set('day_start', e.target.value)} className="bg-bg border rounded-lg px-2 py-1.5 text-sm text-ink" />
            <span className="text-ink-muted">→</span>
            <input type="time" value={cfg.day_end} onChange={e => set('day_end', e.target.value)} className="bg-bg border rounded-lg px-2 py-1.5 text-sm text-ink" />
            <div className="flex items-center gap-1 text-ink-muted text-xs ml-4"><Moon size={13} /> Nuit</div>
            <input type="time" value={cfg.night_start} onChange={e => set('night_start', e.target.value)} className="bg-bg border rounded-lg px-2 py-1.5 text-sm text-ink" />
            <span className="text-ink-muted">→</span>
            <input type="time" value={cfg.night_end} onChange={e => set('night_end', e.target.value)} className="bg-bg border rounded-lg px-2 py-1.5 text-sm text-ink" />
          </div>
        </div>

        <Rotation title="Rotation hebdomadaire" k="weekly" hint="Le garde de la semaine (jour + nuit, 2e départ). Change chaque lundi, dans cet ordre." />
        <Rotation title="Rotation du mercredi" k="wednesday" hint="Premier départ de nuit le mercredi (jour de congé de l'homme de nuit). Ordre indépendant." />

        <div className="bg-surface border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-ink text-sm">Aperçu (4 prochaines semaines)</h2>
            <button onClick={loadPreview} className="text-xs text-brand hover:underline">Rafraîchir l'aperçu</button>
          </div>
          {!preview.length ? <p className="text-ink-muted text-sm">Enregistre puis rafraîchis pour visualiser.</p> : (
            <div className="flex flex-col gap-1.5">
              {preview.map((w: any) => (
                <div key={w.date} className="flex items-center gap-3 text-sm bg-surface-2 rounded-lg px-3 py-2">
                  <span className="text-ink-muted text-xs w-14">S{w.week_no}</span>
                  <span className="text-ink-muted text-xs w-20">{w.date}</span>
                  <span className="text-ink">Garde : <b>{w.weekly_garde_name || '—'}</b></span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
