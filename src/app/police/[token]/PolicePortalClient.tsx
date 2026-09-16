'use client'

// Espace policier (public) : ses saisies sans réquisitoire → dépôt direct ;
// celles déjà reçues ; les saisies sans policier identifié → « C'est mon
// dossier ». Sobre, styles inline, même charte que la page de dépôt.
// Olivier 16/09/2026.

import { useEffect, useRef, useState } from 'react'

interface Officer { id: number; name: string; email: string | null; zone: string | null }
interface Vehicle {
  id: string; ref: string | null; plate: string | null; vehicle: string | null
  location: string | null; saisie_at: string | null; motif: string | null; pv: string | null
  zone: string | null; officer_name: string | null; token: string | null; received_at: string | null
}
interface Data { officer: Officer; pending: Vehicle[]; received: Vehicle[]; unassigned: Vehicle[] }

const fmt = (iso?: string | null) => {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }) } catch { return '—' }
}

export default function PolicePortalClient({ token }: { token: string }) {
  const [data, setData]   = useState<Data | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'invalid'>('loading')
  const [showOthers, setShowOthers] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const load = () => fetch(`/api/police-portal/${token}`, { cache: 'no-store' })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then((j: Data) => { setData(j); setState('ready') })
    .catch(() => setState('invalid'))
  useEffect(() => { load() }, [token])   // eslint-disable-line react-hooks/exhaustive-deps

  const claim = async (v: Vehicle) => {
    if (!confirm(`Vous attribuer le dossier ${v.plate || v.ref || ''} ? Le service fourrière en sera informé.`)) return
    const r = await fetch(`/api/police-portal/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'claim', mission_id: v.id }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setFlash(`⚠ ${j?.error || 'Attribution impossible'}`); return }
    setFlash(`✓ Dossier ${v.plate || ''} attribué — vous pouvez déposer le réquisitoire ci-dessus.`)
    await load()
  }

  const sameZone = (v: Vehicle) => !!data?.officer.zone && v.zone === data.officer.zone
  const mineZone   = (data?.unassigned || []).filter(v => sameZone(v) || !v.zone)
  const otherZones = (data?.unassigned || []).filter(v => !sameZone(v) && !!v.zone)

  return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={S.header}>
          <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-.3px' }}>VERVIERS DÉPANNAGE</div>
          <div style={{ fontSize: 12, opacity: .8 }}>Service Fourrière · Espace policier</div>
        </div>

        <div style={S.body}>
          {state === 'loading' && <p style={S.muted}>Chargement…</p>}

          {state === 'invalid' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 40 }}>⚠️</div>
              <h1 style={S.h1}>Lien invalide ou expiré</h1>
              <p style={S.muted}>Demandez un nouveau lien au service fourrière (fourriere@verviersdepannage.be).</p>
            </div>
          )}

          {state === 'ready' && data && (
            <>
              <h1 style={S.h1}>Bonjour {data.officer.name}</h1>
              <p style={S.muted}>
                {data.officer.zone ? `${data.officer.zone} · ` : ''}
                Voici les véhicules saisis placés en fourrière qui vous concernent.
              </p>

              {flash && <div style={S.flash}>{flash}</div>}

              {/* ── 1. Réquisitoires à déposer ─────────────────────────────── */}
              <h2 style={S.h2}>📋 Réquisitoires à déposer <span style={S.count}>{data.pending.length}</span></h2>
              {data.pending.length === 0
                ? <p style={S.empty}>Aucun réquisitoire en attente de votre part. Merci !</p>
                : data.pending.map(v => <PendingCard key={v.id} v={v} onDone={load} />)}

              {/* ── 2. Saisies sans policier identifié ─────────────────────── */}
              {(mineZone.length > 0 || otherZones.length > 0) && (
                <>
                  <h2 style={S.h2}>🚔 Saisies sans policier identifié <span style={S.count}>{mineZone.length + otherZones.length}</span></h2>
                  <p style={S.muted}>
                    Pour ces véhicules, le policier requérant n'a pas été identifié à l'enlèvement.
                    Si l'un d'eux est le vôtre, attribuez-vous le dossier pour y déposer le réquisitoire.
                  </p>
                  {mineZone.map(v => <ClaimCard key={v.id} v={v} onClaim={() => claim(v)} />)}
                  {otherZones.length > 0 && (
                    <>
                      <button type="button" style={S.linkBtn} onClick={() => setShowOthers(s => !s)}>
                        {showOthers ? '▾' : '▸'} {otherZones.length} autre(s) zone(s) de police
                      </button>
                      {showOthers && otherZones.map(v => <ClaimCard key={v.id} v={v} onClaim={() => claim(v)} />)}
                    </>
                  )}
                </>
              )}

              {/* ── 3. Déjà reçus ──────────────────────────────────────────── */}
              {data.received.length > 0 && (
                <>
                  <h2 style={S.h2}>✅ Réquisitoires reçus <span style={S.count}>{data.received.length}</span></h2>
                  {data.received.map(v => (
                    <div key={v.id} style={{ ...S.row, opacity: .75 }}>
                      <div>
                        <span style={S.plate}>{v.plate || '—'}</span>
                        <span style={{ marginLeft: 8, color: '#334155', fontSize: 14 }}>{v.vehicle || ''}</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>reçu le {fmt(v.received_at)}</div>
                    </div>
                  ))}
                </>
              )}

              <p style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', margin: '24px 0 0' }}>
                Lien personnel · Transmission sécurisée · Verviers Dépannage SA · fourriere@verviersdepannage.be
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Carte « à déposer » : infos + dépôt PDF/photo via le dépôt par fiche existant.
function PendingCard({ v, onDone }: { v: Vehicle; onDone: () => void }) {
  const [files, setFiles] = useState<File[]>([])
  const [note, setNote]   = useState('')
  const [busy, setBusy]   = useState(false)
  const [err, setErr]     = useState<string | null>(null)
  const [done, setDone]   = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = async () => {
    if (!v.token) { setErr('Dépôt indisponible pour ce dossier — contactez le service fourrière.'); return }
    if (!files.length) { setErr('Joignez le réquisitoire (PDF ou photo).'); return }
    setBusy(true); setErr(null)
    try {
      const fd = new FormData()
      files.forEach(f => fd.append('files', f))
      if (note.trim()) fd.append('note', note.trim())
      const r = await fetch(`/api/requisitoire/depot/${v.token}`, { method: 'POST', body: fd })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error || 'Erreur')
      setDone(true); onDone()
    } catch (e: any) { setErr(e?.message || 'Envoi impossible'); setBusy(false) }
  }

  return (
    <div style={S.pending}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <span style={S.plate}>{v.plate || '—'}</span>
          <span style={{ marginLeft: 8, color: '#0b1120', fontSize: 14, fontWeight: 600 }}>{v.vehicle || ''}</span>
        </div>
        {v.ref && <span style={{ fontSize: 12, color: '#64748b' }}>Réf. {v.ref}</span>}
      </div>
      <div style={{ fontSize: 13, color: '#475569', marginTop: 6, lineHeight: 1.5 }}>
        Saisie le <strong>{fmt(v.saisie_at)}</strong>{v.location ? ` · ${v.location}` : ''}
        {v.pv ? <> · PV <strong>{v.pv}</strong></> : ''}{v.motif ? ` · ${v.motif}` : ''}
      </div>
      {done ? (
        <div style={{ marginTop: 10, color: '#15803d', fontWeight: 600, fontSize: 14 }}>✅ Réquisitoire bien reçu, merci.</div>
      ) : (
        <>
          <label style={S.drop} onClick={() => inputRef.current?.click()}>
            <input ref={inputRef} type="file" accept="application/pdf,image/*" multiple style={{ display: 'none' }}
              onChange={e => setFiles(Array.from(e.target.files || []))} />
            {files.length
              ? <span style={{ color: '#0b1120', fontWeight: 600 }}>📎 {files.map(f => f.name).join(', ')}</span>
              : <span style={{ color: '#64748b' }}>📎 Joindre le réquisitoire (PDF ou photo)</span>}
          </label>
          {files.length > 0 && (
            <>
              <textarea style={S.textarea} placeholder="Remarque (facultatif)" value={note} onChange={e => setNote(e.target.value)} rows={2} />
              <button style={{ ...S.btn, opacity: busy ? .6 : 1 }} disabled={busy} onClick={submit}>{busy ? 'Envoi…' : 'Envoyer le réquisitoire'}</button>
            </>
          )}
          {err && <p style={{ color: '#b91c1c', fontSize: 13, margin: '6px 0 0' }}>⚠ {err}</p>}
        </>
      )}
    </div>
  )
}

function ClaimCard({ v, onClaim }: { v: Vehicle; onClaim: () => void }) {
  return (
    <div style={S.row}>
      <div style={{ minWidth: 0 }}>
        <span style={S.plate}>{v.plate || '—'}</span>
        <span style={{ marginLeft: 8, color: '#334155', fontSize: 14 }}>{v.vehicle || ''}</span>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
          saisie le {fmt(v.saisie_at)}{v.location ? ` · ${v.location}` : ''}{v.zone ? ` · ${v.zone}` : ''}
          {v.officer_name ? <> · nom relevé : <em>{v.officer_name}</em></> : ''}
        </div>
      </div>
      <button type="button" style={S.claimBtn} onClick={onClaim}>C'est mon dossier</button>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: { minHeight: '100vh', background: '#f0f2f5', display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    padding: '24px 16px', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif' },
  card: { width: '100%', maxWidth: 640, background: '#fff', borderRadius: 14, overflow: 'hidden', boxShadow: '0 4px 24px rgba(15,23,42,.1)' },
  header: { background: '#CC2222', color: '#fff', padding: '20px 28px' },
  body: { padding: '28px' },
  h1: { fontSize: 22, fontWeight: 800, color: '#0b1120', margin: '0 0 8px' },
  h2: { fontSize: 15, fontWeight: 800, color: '#0b1120', margin: '26px 0 10px', display: 'flex', alignItems: 'center', gap: 8 },
  count: { background: '#0b1120', color: '#fff', borderRadius: 999, fontSize: 12, padding: '1px 8px', fontWeight: 700 },
  muted: { fontSize: 14, color: '#64748b', lineHeight: 1.55, margin: '0 0 14px' },
  empty: { fontSize: 14, color: '#15803d', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '10px 14px', margin: 0 },
  flash: { fontSize: 14, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e3a8a', borderRadius: 10, padding: '10px 14px', margin: '0 0 14px' },
  pending: { background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, padding: '14px 16px', margin: '0 0 10px' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 12, padding: '10px 14px', margin: '0 0 8px' },
  plate: { fontFamily: 'ui-monospace,Menlo,monospace', fontWeight: 800, fontSize: 15, color: '#0b1120', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, padding: '2px 8px' },
  drop: { display: 'block', border: '2px dashed #fdba74', borderRadius: 10, padding: '14px', textAlign: 'center', cursor: 'pointer', fontSize: 14, margin: '12px 0 0', background: '#fff' },
  textarea: { width: '100%', boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 10, padding: '10px 12px', fontSize: 14, resize: 'vertical' as any, marginTop: 10 },
  btn: { width: '100%', marginTop: 10, background: '#CC2222', color: '#fff', border: 'none', borderRadius: 10, padding: '12px', fontSize: 15, fontWeight: 700, cursor: 'pointer' },
  claimBtn: { background: '#0b1120', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' },
  linkBtn: { background: 'none', border: 'none', color: '#475569', fontSize: 13, cursor: 'pointer', padding: '4px 0', margin: '2px 0 8px' },
}
