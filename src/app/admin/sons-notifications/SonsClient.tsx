'use client'
// Écoute des 9 propositions par famille (classiques : 3 sans voix, 2 avec voix ; fun :
// 2 sans voix, 2 avec voix) et choix du son joué sur l'iPhone. Enregistré dès le choix.
import { useRef, useState } from 'react'

const GROUPS: { title: string; note?: string; opts: { v: string; label: string }[] }[] = [
  { title: 'Classique', opts: [{ v: '1', label: 'Son 1' }, { v: '2', label: 'Son 2' }, { v: '3', label: 'Son 3' }, { v: 'v1', label: 'Voix 1' }, { v: 'v2', label: 'Voix 2' }] },
  { title: 'Fun', note: 'app iPhone version 35 ou plus récente', opts: [{ v: 'f1', label: 'Fun 1' }, { v: 'f2', label: 'Fun 2' }, { v: 'fv1', label: 'Fun voix 1' }, { v: 'fv2', label: 'Fun voix 2' }] },
]
const FUN = ['f1', 'f2', 'fv1', 'fv2']

export default function SonsClient({ families, initial, labels }: { families: { key: string; label: string; desc: string }[]; initial: Record<string, string>; labels: Record<string, Record<string, string>> }) {
  const [choices, setChoices] = useState<Record<string, string>>(initial)
  const [saving, setSaving] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)

  const play = (fam: string, v: string) => {
    try { audio.current?.pause() } catch { /* rien */ }
    const a = new Audio(`/noprecache/sons/vd/vd_${fam}_${v}.${FUN.includes(v) ? 'mp3' : 'wav'}`); audio.current = a
    a.play().catch(() => setMsg('Le son n’a pas pu être joué sur cet appareil.'))
  }
  const pick = async (fam: string, v: string) => {
    const next = { ...choices, [fam]: v }
    setChoices(next); setSaving(fam); setMsg(null)
    try {
      const r = await fetch('/api/admin/notif-sons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choices: next }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Non enregistré')
      setChoices(j.choices); setMsg(FUN.includes(v) ? 'Enregistré. Les iPhone qui n’ont pas encore la version 35 de l’app jouent leur son habituel en attendant.' : 'Enregistré : les prochaines notifications utiliseront ce son.')
    } catch (e: any) { setChoices(choices); setMsg(e?.message || 'Non enregistré') } finally { setSaving(null) }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
      <div>
        <h1 className="text-ink font-bold text-xl">🔔 Sons des notifications</h1>
        <p className="text-ink-muted text-sm mt-1">Pour chaque famille, écoute les propositions (▶) puis choisis celle que les iPhone joueront quand l’app est fermée. Sons classiques : version 30 de l’app ou plus récente ; sons fun : version 35. Avant, l’iPhone garde son son habituel.</p>
      </div>
      {msg && <p className="rounded-xl bg-surface-2 border border-border px-3 py-2 text-sm text-ink-secondary">{msg}</p>}
      {families.map(f => (
        <div key={f.key} className="rounded-2xl border border-border bg-surface p-3 space-y-2">
          <div>
            <p className="text-ink font-semibold">{f.label}{saving === f.key ? ' · enregistrement…' : ''}</p>
            <p className="text-ink-muted text-xs">{f.desc}</p>
          </div>
          {GROUPS.map(g => (
            <div key={g.title} className="space-y-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">{g.title}{g.note ? ` · ${g.note}` : ''}</p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {g.opts.map(o => {
                  const on = choices[f.key] === o.v
                  return (
                    <div key={o.v} className={`rounded-xl border-2 p-1.5 flex flex-col gap-1.5 ${on ? 'border-brand bg-brand/10' : 'border-border'}`}>
                      <button type="button" onClick={() => play(f.key, o.v)} className="min-h-[44px] rounded-lg bg-surface-2 text-ink text-sm font-semibold">▶ {o.label}</button>
                      {labels[f.key]?.[o.v] && <p className="text-[11px] leading-snug text-ink-secondary px-0.5">{labels[f.key][o.v]}</p>}
                      <button type="button" disabled={!!saving} onClick={() => pick(f.key, o.v)} className={`mt-auto min-h-[44px] rounded-lg text-sm font-semibold ${on ? 'bg-brand text-white' : 'border border-strong text-ink'}`}>{on ? '✓ Choisi' : 'Choisir'}</button>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
