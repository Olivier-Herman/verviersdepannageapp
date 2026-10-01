'use client'
// Écoute des 5 propositions par famille (3 sans voix, 2 avec voix) et choix du son
// joué sur l'iPhone (app version 30 ou plus récente). Enregistré dès le choix.
import { useRef, useState } from 'react'

const OPTIONS: { v: string; label: string }[] = [
  { v: '1', label: 'Son 1' }, { v: '2', label: 'Son 2' }, { v: '3', label: 'Son 3' },
  { v: 'v1', label: 'Voix 1' }, { v: 'v2', label: 'Voix 2' },
]

export default function SonsClient({ families, initial }: { families: { key: string; label: string; desc: string }[]; initial: Record<string, string> }) {
  const [choices, setChoices] = useState<Record<string, string>>(initial)
  const [saving, setSaving] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)

  const play = (fam: string, v: string) => {
    try { audio.current?.pause() } catch { /* rien */ }
    const a = new Audio(`/noprecache/sons/vd/vd_${fam}_${v}.wav`); audio.current = a
    a.play().catch(() => setMsg('Le son n’a pas pu être joué sur cet appareil.'))
  }
  const pick = async (fam: string, v: string) => {
    const next = { ...choices, [fam]: v }
    setChoices(next); setSaving(fam); setMsg(null)
    try {
      const r = await fetch('/api/admin/notif-sons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choices: next }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Non enregistré')
      setChoices(j.choices); setMsg('Enregistré : les prochaines notifications utiliseront ce son.')
    } catch (e: any) { setChoices(choices); setMsg(e?.message || 'Non enregistré') } finally { setSaving(null) }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
      <div>
        <h1 className="text-ink font-bold text-xl">🔔 Sons des notifications</h1>
        <p className="text-ink-muted text-sm mt-1">Pour chaque famille, écoute les propositions (▶) puis choisis celle que les iPhone joueront. Il faut la version 30 de l’app ou plus récente ; avant, l’iPhone garde son son habituel.</p>
      </div>
      {msg && <p className="rounded-xl bg-surface-2 border border-border px-3 py-2 text-sm text-ink-secondary">{msg}</p>}
      {families.map(f => (
        <div key={f.key} className="rounded-2xl border border-border bg-surface p-3 space-y-2">
          <div>
            <p className="text-ink font-semibold">{f.label}{saving === f.key ? ' · enregistrement…' : ''}</p>
            <p className="text-ink-muted text-xs">{f.desc}</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {OPTIONS.map(o => {
              const on = choices[f.key] === o.v
              return (
                <div key={o.v} className={`rounded-xl border-2 p-1.5 flex flex-col gap-1.5 ${on ? 'border-brand bg-brand/10' : 'border-border'}`}>
                  <button type="button" onClick={() => play(f.key, o.v)} className="min-h-[44px] rounded-lg bg-surface-2 text-ink text-sm font-semibold">▶ {o.label}</button>
                  <button type="button" disabled={!!saving} onClick={() => pick(f.key, o.v)} className={`min-h-[44px] rounded-lg text-sm font-semibold ${on ? 'bg-brand text-white' : 'border border-strong text-ink'}`}>{on ? '✓ Choisi' : 'Choisir'}</button>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
