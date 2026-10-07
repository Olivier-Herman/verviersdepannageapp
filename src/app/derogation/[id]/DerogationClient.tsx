'use client'

// Validation d'une dérogation par le responsable, sur son téléphone : il voit
// qui demande, pour quel véhicule, quoi et pourquoi, puis autorise ou refuse
// avec son code personnel (4 chiffres). Olivier 28/09/2026.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

export default function DerogationClient({ id }: { id: string }) {
  const [x, setX] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pin, setPin] = useState(['', '', '', ''])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const refs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]
  const load = () => fetch(`/api/derogations/${id}`, { cache: 'no-store' }).then(r => r.json()).then(j => { if (j.error) setErr(j.error); else setX(j) }).catch(() => setErr('Chargement impossible'))
  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (decision: 'approve' | 'refuse') => {
    const code = pin.join('')
    if (code.length !== 4) { refs[0].current?.focus(); return }
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/derogations/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, pin: code }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Refusé')
      setResult(j.status === 'approved' ? 'Dérogation autorisée. Le comptoir est débloqué.' : 'Dérogation refusée. Le comptoir est prévenu.')
      load()
    } catch (e: any) { setErr(e?.message); setPin(['', '', '', '']); refs[0].current?.focus() } finally { setBusy(false) }
  }

  if (!x) return <div className="max-w-md mx-auto px-4 py-6 text-sm text-ink-muted">{err || 'Chargement…'}</div>
  const r = x.request, m = x.mission
  return (
    <div className="max-w-md mx-auto px-4 py-5 flex flex-col gap-3">
      <div className="rounded-card border border-border bg-surface p-4 flex flex-col gap-2">
        <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Dérogation demandée par {r.requested_by_name || '—'}</div>
        <div className="font-display text-xl font-bold text-ink">{r.label}</div>
        <div className="font-mono text-lg text-ink">{m?.vehicle_plate || '—'} <span className="font-sans text-sm text-ink-muted">{[m?.vehicle_brand, m?.vehicle_model].filter(Boolean).join(' ')} · zone {m?.parc_zone_key || '?'}</span></div>
        <div className="rounded-xl bg-surface-2 px-3 py-2 text-sm"><b>Motif :</b> {r.reason}{r.amount_tvac ? <><br /><b>Montant demandé :</b> {Number(r.amount_tvac).toFixed(2)} € TVAC</> : null}</div>
        {m && <Link href={`/dispatch/${m.id}`} className="self-start text-sm underline">Voir la fiche</Link>}
      </div>
      {result && <p className="rounded-xl bg-success-soft text-success px-3 py-2 font-semibold">{result}</p>}
      {r.status !== 'pending' && !result && <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink-secondary">Demande {r.status === 'approved' ? 'déjà autorisée' : r.status === 'refused' ? 'déjà refusée' : 'annulée'}.</p>}
      {r.status === 'pending' && !x.mine && <p className="rounded-xl bg-warning-soft text-warning px-3 py-2 text-sm font-semibold">Cette demande est adressée à {r.responsable_name}.</p>}
      {r.status === 'pending' && x.mine && (
        <div className="rounded-card border border-border bg-surface p-4 flex flex-col gap-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Votre code</div>
          <div className="flex gap-2 justify-center">
            {pin.map((d, i) => <input key={i} ref={refs[i]} type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" data-lpignore="true" data-1p-ignore="true" style={{ WebkitTextSecurity: 'disc' } as any} maxLength={1} value={d} aria-label={`Chiffre ${i + 1}`}
              onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(-1); setPin(p => { const n = [...p]; n[i] = v; return n }); if (v && i < 3) refs[i + 1].current?.focus() }}
              onKeyDown={e => { if (e.key === 'Backspace' && !pin[i] && i > 0) refs[i - 1].current?.focus() }}
              className="w-14 h-16 text-center font-mono text-2xl font-bold rounded-btn border border-strong bg-surface text-ink" />)}
          </div>
          {err && <p className="text-sm text-critical font-semibold text-center">{err}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => decide('approve')} className="flex-1 min-h-[50px] rounded-btn bg-success-fill text-white font-bold disabled:opacity-50">Autoriser</button>
            <button type="button" disabled={busy} onClick={() => decide('refuse')} className="flex-1 min-h-[50px] rounded-btn border border-strong bg-surface text-ink font-bold disabled:opacity-50">Refuser</button>
          </div>
        </div>
      )}
    </div>
  )
}
