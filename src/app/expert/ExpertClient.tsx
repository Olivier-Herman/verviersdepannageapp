'use client'
// src/app/expert/ExpertClient.tsx
//
// Espace expert sur le téléphone (page publique /expert). Olivier 2026-09-05.
//   1. Première fois : prénom + bureau → demande d'accès → attente de la
//      validation au comptoir (popup chez le bureau fourrière).
//   2. Ensuite : la clé est sur le téléphone → plaque → zone + photos →
//      « Véhicule vu ». Plusieurs bureaux possibles (chaque ajout = validation).
//   3. « Mes véhicules » : ceux qu'il a vus, état, photos, question au
//      bureau, chemin de sortie (Informex / autre) quand la fiche est armée.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Search, Check, Plus, MapPin, Camera, MessageCircle, ChevronDown, ChevronUp, Building2, AlertTriangle } from 'lucide-react'

const KEY = 'vd_expert_key'
const LAST_BUREAU = 'vd_expert_bureau'

type Snapshot = {
  device: { id: string; first_name: string } | null
  bureaus: { id: string; bureau: string; status: string }[]
  approved: string[]
  vehicles: any[]
  catalog: string[]
}

const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

export default function ExpertClient() {
  const [key, setKey] = useState<string | null>(null)
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Inscription
  const [firstName, setFirstName] = useState('')
  const [bureau, setBureau] = useState('')
  // Recherche
  const [plate, setPlate] = useState('')
  const [useBureau, setUseBureau] = useState('')
  const [result, setResult] = useState<any>(null)
  const [seenOk, setSeenOk] = useState(false)
  // Ajout bureau
  const [showAdd, setShowAdd] = useState(false)
  const [addBureau, setAddBureau] = useState('')
  // Liste
  const [open, setOpen] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (k: string | null) => {
    try {
      const r = await fetch(`/api/expert${k ? `?key=${encodeURIComponent(k)}` : ''}`, { cache: 'no-store' })
      const j = await r.json()
      setSnap(j)
      if (k && !j.device) { try { localStorage.removeItem(KEY) } catch {} setKey(null) }
      return j as Snapshot
    } catch { setError('Connexion impossible. Réessaie.'); return null }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    let k: string | null = null
    try { k = localStorage.getItem(KEY); setUseBureau(localStorage.getItem(LAST_BUREAU) || '') } catch {}
    setKey(k); load(k)
  }, [load])

  // Tant qu'une demande est en attente : interroge toutes les 3 s.
  const pending = !!snap?.bureaus?.some(b => b.status === 'pending')
  useEffect(() => {
    if (!key || !pending) { if (pollRef.current) clearInterval(pollRef.current); return }
    pollRef.current = setInterval(() => load(key), 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [key, pending, load])

  async function post(payload: any) {
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/expert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, ...payload }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      return j
    } catch (e: any) { setError(e.message); return null }
    finally { setBusy(false) }
  }

  async function register() {
    const j = await post({ action: 'register', first_name: firstName.trim(), bureau })
    if (!j) return
    try { localStorage.setItem(KEY, j.key); localStorage.setItem(LAST_BUREAU, bureau) } catch {}
    setKey(j.key); setSnap(s => ({ ...(s as any), ...j, catalog: s?.catalog || [] })); setUseBureau(bureau)
  }
  async function requestAdd() {
    const j = await post({ action: 'add_bureau', bureau: addBureau })
    if (j) { setSnap(s => ({ ...(s as any), ...j, catalog: s?.catalog || [] })); setShowAdd(false); setAddBureau('') }
  }
  async function lookup() {
    setResult(null); setSeenOk(false)
    const j = await post({ action: 'lookup', plate: plate.trim(), bureau: useBureau })
    if (j) { setResult(j); try { localStorage.setItem(LAST_BUREAU, useBureau) } catch {} }
  }
  async function seen() {
    if (!result?.vehicle) return
    const j = await post({ action: 'seen', mission_id: result.vehicle.id, bureau: useBureau })
    if (j) { setSeenOk(true); setSnap(s => ({ ...(s as any), ...j, catalog: s?.catalog || [] })) }
  }

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-page text-ink">
      <div className="max-w-md mx-auto p-4 pb-12 flex flex-col gap-4">
        <header className="flex items-center gap-3">
          <img src="/vd-logo.png" alt="Verviers Dépannage" className="h-9 w-auto" />
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-ink-muted">Fourrière de Pepinster</p>
            <h1 className="font-bold text-lg leading-tight">Accès experts</h1>
          </div>
        </header>
        {error && <p className="text-critical text-sm bg-critical/10 border border-critical/30 rounded-lg px-3 py-2">{error}</p>}
        {children}
        <p className="text-xs text-ink-muted text-center">Véhicules accidentés déposés par la police uniquement. Pour tout autre véhicule, adressez-vous au comptoir. Lundi–vendredi 9h–17h · 087 35 18 20</p>
      </div>
    </div>
  )

  if (loading || !snap) return shell(<p className="text-ink-muted flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Chargement…</p>)

  // ── 1. Première fois ──────────────────────────────────────────────────────
  if (!key || !snap.device) {
    return shell(
      <div className="bg-surface border rounded-xl p-4 flex flex-col gap-3">
        <p className="font-semibold">Bienvenue. Une seule fois :</p>
        <label className="text-sm"><span className="text-ink-secondary">Votre prénom</span>
          <input value={firstName} onChange={e => setFirstName(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2.5 bg-surface" placeholder="Prénom" autoComplete="given-name" /></label>
        <label className="text-sm"><span className="text-ink-secondary">Votre bureau d'expertise</span>
          <select value={bureau} onChange={e => setBureau(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2.5 bg-surface">
            <option value="">— Choisir —</option>
            {snap.catalog.map(b => <option key={b} value={b}>{b}</option>)}
          </select></label>
        <p className="text-xs text-ink-muted">Le comptoir active votre accès en un clic. Votre téléphone garde ensuite la clé : plus rien à encoder. Vous travaillez pour plusieurs bureaux ? Vous pourrez les ajouter après.</p>
        <button onClick={register} disabled={busy || !firstName.trim() || !bureau} className="py-3 rounded-xl bg-brand text-white font-bold disabled:opacity-40 flex items-center justify-center gap-2">
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} Demander l'accès
        </button>
      </div>,
    )
  }

  const approved = snap.approved || []
  const pendingRows = snap.bureaus.filter(b => b.status === 'pending')
  const refusedRows = snap.bureaus.filter(b => b.status === 'refused')
  if (!useBureau || !approved.includes(useBureau)) { if (approved[0] && useBureau !== approved[0]) setUseBureau(approved[0]) }

  // ── 2. En attente de validation ───────────────────────────────────────────
  if (!approved.length) {
    return shell(
      <div className="bg-surface border rounded-xl p-4 flex flex-col gap-3">
        <p className="font-semibold">Bonjour {snap.device.first_name}</p>
        {pendingRows.length > 0 ? (
          <div className="bg-warning/10 border border-warning/40 rounded-lg p-3 text-sm flex items-start gap-2">
            <Loader2 size={16} className="animate-spin mt-0.5" />
            <p>Demande envoyée au comptoir pour <b>{pendingRows.map(b => b.bureau).join(', ')}</b>. Dès que le bureau valide, cette page continue toute seule.</p>
          </div>
        ) : refusedRows.length > 0 ? (
          <div className="bg-critical/10 border border-critical/40 rounded-lg p-3 text-sm flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5" />
            <p>Accès refusé pour {refusedRows.map(b => b.bureau).join(', ')}. Adressez-vous au comptoir.</p>
          </div>
        ) : null}
        {refusedRows.length > 0 && (
          <button onClick={() => post({ action: 'add_bureau', bureau: refusedRows[0].bureau }).then(j => j && setSnap(s => ({ ...(s as any), ...j, catalog: s?.catalog || [] })))} disabled={busy} className="py-2 rounded-lg border text-sm">Redemander</button>
        )}
      </div>,
    )
  }

  // ── 3. Espace expert ──────────────────────────────────────────────────────
  const v = result?.vehicle
  return shell(
    <>
      <div className="bg-surface border rounded-xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold">Bonjour {snap.device.first_name}</p>
          <button onClick={() => setShowAdd(s => !s)} className="text-xs text-brand flex items-center gap-1"><Plus size={14} /> Ajouter un bureau</button>
        </div>
        {showAdd && (
          <div className="flex gap-2">
            <select value={addBureau} onChange={e => setAddBureau(e.target.value)} className="flex-1 border rounded-lg px-3 py-2 bg-surface text-sm">
              <option value="">— Bureau —</option>
              {snap.catalog.filter(b => !snap.bureaus.some(x => x.bureau === b && x.status !== 'refused')).map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <button onClick={requestAdd} disabled={busy || !addBureau} className="px-3 rounded-lg bg-brand text-white text-sm font-semibold disabled:opacity-40">Demander</button>
          </div>
        )}
        {pendingRows.length > 0 && <p className="text-xs text-warning flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> En attente de validation : {pendingRows.map(b => b.bureau).join(', ')}</p>}

        {approved.length > 1 && (
          <label className="text-sm"><span className="text-ink-secondary">Je viens pour</span>
            <select value={useBureau} onChange={e => setUseBureau(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2.5 bg-surface">
              {approved.map(b => <option key={b} value={b}>{b}</option>)}
            </select></label>
        )}
        {approved.length === 1 && <p className="text-xs text-ink-muted flex items-center gap-1"><Building2 size={12} /> {approved[0]}</p>}

        <div className="flex gap-2">
          <input value={plate} onChange={e => setPlate(e.target.value.toUpperCase())} onKeyDown={e => { if (e.key === 'Enter') lookup() }}
            className="flex-1 border rounded-lg px-3 py-3 bg-surface font-mono text-lg tracking-wider" placeholder="Plaque (1-ABC-123)" autoCapitalize="characters" />
          <button onClick={lookup} disabled={busy || plate.trim().length < 3 || !useBureau} className="px-4 rounded-lg bg-brand text-white font-semibold disabled:opacity-40"><Search size={18} /></button>
        </div>

        {result && !result.found && (
          <div className="bg-warning/10 border border-warning/40 rounded-lg p-3 text-sm">{result.message}</div>
        )}
        {v && (
          <div className="border rounded-xl p-3 flex flex-col gap-2 bg-success/5 border-success/40">
            <p className="font-mono text-xl font-bold tracking-wider">{v.plate}</p>
            <p className="text-sm text-ink-secondary">{[v.brand, v.model].filter(Boolean).join(' ')}{v.parked_at ? ` · en parc depuis le ${fmt(v.parked_at)}` : ''}</p>
            <p className="text-lg font-bold flex items-center gap-2"><MapPin size={20} className="text-brand" /> Zone {v.zone || '?'}</p>
            {v.photos?.length > 0 ? (
              <div className="grid grid-cols-3 gap-1.5">
                {v.photos.map((src: string) => <a key={src} href={src} target="_blank" rel="noreferrer"><img src={src} alt="" className="aspect-[4/3] w-full object-cover rounded-md border" /></a>)}
              </div>
            ) : <p className="text-xs text-ink-muted flex items-center gap-1"><Camera size={12} /> Pas de photo d'entrée disponible.</p>}
            {seenOk ? (
              <p className="text-success font-semibold text-sm flex items-center gap-1"><Check size={16} /> Passage enregistré. Merci !</p>
            ) : (
              <button onClick={seen} disabled={busy} className="py-3 rounded-xl bg-success text-white font-bold disabled:opacity-40 flex items-center justify-center gap-2">
                {busy ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} Véhicule vu
              </button>
            )}
          </div>
        )}
      </div>

      {/* Mes véhicules */}
      <div className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-wide text-ink-muted">Mes véhicules ({snap.vehicles.length})</p>
        {snap.vehicles.length === 0 && <p className="text-sm text-ink-muted">Aucun véhicule vu pour l'instant.</p>}
        {snap.vehicles.map(m => (
          <VehicleCard key={m.id} m={m} open={open === m.id} onToggle={() => setOpen(open === m.id ? null : m.id)} post={post} onChanged={j => setSnap(s => ({ ...(s as any), ...j, catalog: s?.catalog || [] }))} busy={busy} />
        ))}
      </div>
    </>,
  )
}

function VehicleCard({ m, open, onToggle, post, onChanged, busy }: { m: any; open: boolean; onToggle: () => void; post: (p: any) => Promise<any>; onChanged: (j: any) => void; busy: boolean }) {
  const [note, setNote] = useState('')
  const [sent, setSent] = useState(false)
  const [path, setPath] = useState<'informex' | 'autre'>('informex')
  const [dest, setDest] = useState('')
  const e = m.exit
  const status = !m.in_parc ? `Sorti le ${fmt(m.left_at)}` : e?.forced ? 'Sortie forcée' : e ? (e.path ? `Sortie ${e.path === 'informex' ? 'Informex' : `→ ${e.destination}`}${e.signed ? ' · attestation signée' : ''}` : 'En parc — chemin de sortie à indiquer') : 'En parc'
  return (
    <div className="bg-surface border rounded-xl">
      <button onClick={onToggle} className="w-full text-left px-4 py-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono font-bold tracking-wider">{m.plate || '—'} <span className="font-sans font-normal text-ink-secondary text-sm">{[m.brand, m.model].filter(Boolean).join(' ')}</span></p>
          <p className="text-xs text-ink-muted">{m.in_parc ? `Zone ${m.zone || '?'} · ` : ''}{status} · vu le {fmt(m.visited_at)} · {m.bureau}</p>
        </div>
        {open ? <ChevronUp size={18} className="text-ink-muted" /> : <ChevronDown size={18} className="text-ink-muted" />}
      </button>
      {open && (
        <div className="px-4 pb-4 flex flex-col gap-3 border-t pt-3">
          {m.photos?.length > 0 && (
            <div className="grid grid-cols-3 gap-1.5">
              {m.photos.map((src: string) => <a key={src} href={src} target="_blank" rel="noreferrer"><img src={src} alt="" className="aspect-[4/3] w-full object-cover rounded-md border" /></a>)}
            </div>
          )}
          {m.in_parc && e && !e.path && (
            <div className="flex flex-col gap-2 bg-warning/5 border border-warning/40 rounded-lg p-3">
              <p className="text-sm font-semibold">Comment ce véhicule va-t-il sortir ?</p>
              <div className="flex gap-2">
                <button onClick={() => setPath('informex')} className={`flex-1 py-2 rounded-lg border text-sm font-semibold ${path === 'informex' ? 'bg-brand text-white border-brand' : ''}`}>Vendu via Informex</button>
                <button onClick={() => setPath('autre')} className={`flex-1 py-2 rounded-lg border text-sm font-semibold ${path === 'autre' ? 'bg-brand text-white border-brand' : ''}`}>Autre sortie</button>
              </div>
              {path === 'autre' && <input value={dest} onChange={e2 => setDest(e2.target.value)} placeholder="Destination (propriétaire, garage…)" className="border rounded-lg px-3 py-2 bg-surface text-sm" />}
              <button onClick={async () => { const j = await post({ action: 'path', mission_id: m.id, path, destination: dest }); if (j) onChanged(j) }} disabled={busy || (path === 'autre' && !dest.trim())} className="py-2.5 rounded-lg bg-brand text-white text-sm font-semibold disabled:opacity-40">Confirmer</button>
              <p className="text-xs text-ink-muted">Le comptoir ne remettra le véhicule qu'à l'acheteur du bon Informex (ou son mandataire), pièce d'identité et attestation signée à l'appui.</p>
            </div>
          )}
          {m.in_parc && e?.path && <p className="text-sm text-ink-secondary">Chemin de sortie : <b>{e.path === 'informex' ? 'Informex' : `autre → ${e.destination}`}</b>{e.by_name ? ` (indiqué par ${e.by_name})` : ''}</p>}
          <div className="flex flex-col gap-1.5">
            <p className="text-xs uppercase tracking-wide text-ink-muted flex items-center gap-1"><MessageCircle size={12} /> Question ou remarque au bureau</p>
            {sent ? <p className="text-success text-sm">Envoyé au bureau fourrière.</p> : (
              <div className="flex gap-2">
                <input value={note} onChange={e2 => setNote(e2.target.value)} placeholder="Votre message" className="flex-1 border rounded-lg px-3 py-2 bg-surface text-sm" />
                <button onClick={async () => { const j = await post({ action: 'note', mission_id: m.id, text: note }); if (j) { setSent(true); setNote('') } }} disabled={busy || !note.trim()} className="px-3 rounded-lg border text-sm disabled:opacity-40">Envoyer</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
