'use client'

// Page policier : voir le dossier (véhicule saisi) + déposer le réquisitoire.
// Publique, sobre et rassurante. Styles inline (pas d'app shell).

import { useEffect, useRef, useState } from 'react'

interface Info {
  ref: string | null; plate: string | null; vehicle: string | null
  location: string | null; saisie_at: string | null; motif: string | null
  pv: string | null; received: boolean
}

const fmt = (iso?: string | null) => {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }) } catch { return '—' }
}

export default function RequisitoireDepotClient({ token }: { token: string }) {
  const [info, setInfo]     = useState<Info | null>(null)
  const [state, setState]   = useState<'loading' | 'ready' | 'invalid' | 'done'>('loading')
  const [note, setNote]     = useState('')
  const [files, setFiles]   = useState<File[]>([])
  const [busy, setBusy]     = useState(false)
  const [err, setErr]       = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch(`/api/requisitoire/depot/${token}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((j: Info) => { setInfo(j); setState(j.received ? 'done' : 'ready') })
      .catch(() => setState('invalid'))
  }, [token])

  const submit = async () => {
    if (!files.length) { setErr('Joignez le réquisitoire (PDF ou photo).'); return }
    setBusy(true); setErr(null)
    try {
      const fd = new FormData()
      files.forEach(f => fd.append('files', f))
      if (note.trim()) fd.append('note', note.trim())
      const r = await fetch(`/api/requisitoire/depot/${token}`, { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Erreur')
      setState('done')
    } catch (e: any) { setErr(e?.message || 'Envoi impossible'); setBusy(false) }
  }

  return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={S.header}>
          <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-.3px' }}>VERVIERS DÉPANNAGE</div>
          <div style={{ fontSize: 12, opacity: .8 }}>Service Fourrière</div>
        </div>

        <div style={S.body}>
          {state === 'loading' && <p style={S.muted}>Chargement…</p>}

          {state === 'invalid' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 40 }}>⚠️</div>
              <h1 style={S.h1}>Lien invalide</h1>
              <p style={S.muted}>Ce lien de dépôt n'est plus valable. Contactez le service fourrière.</p>
            </div>
          )}

          {state === 'done' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 44 }}>✅</div>
              <h1 style={S.h1}>Réquisitoire bien reçu</h1>
              <p style={S.muted}>Merci, le document a été rattaché au dossier{info?.ref ? ` ${info.ref}` : ''}.</p>
            </div>
          )}

          {state === 'ready' && info && (
            <>
              <h1 style={S.h1}>Dépôt du réquisitoire</h1>
              <p style={S.muted}>
                Merci de nous transmettre le réquisitoire pour le véhicule saisi ci-dessous.
                {info.ref && <> Réf. dossier <strong>{info.ref}</strong>.</>}
              </p>

              <div style={S.info}>
                <Row k="Plaque" v={info.plate} strong />
                <Row k="Véhicule" v={info.vehicle} />
                <Row k="Date de saisie" v={fmt(info.saisie_at)} />
                <Row k="Lieu" v={info.location} />
                {info.pv && <Row k="N° PV" v={info.pv} />}
                {info.motif && <Row k="Motif" v={info.motif} />}
              </div>

              <label style={S.drop} onClick={() => inputRef.current?.click()}>
                <input ref={inputRef} type="file" accept="application/pdf,image/*" multiple style={{ display: 'none' }}
                  onChange={e => setFiles(Array.from(e.target.files || []))} />
                {files.length
                  ? <span style={{ color: '#0b1120', fontWeight: 600 }}>📎 {files.map(f => f.name).join(', ')}</span>
                  : <span style={{ color: '#64748b' }}>📎 Cliquez pour joindre le réquisitoire (PDF ou photo)</span>}
              </label>

              <textarea style={S.textarea} placeholder="Remarque (facultatif)" value={note} onChange={e => setNote(e.target.value)} rows={2} />

              {err && <p style={{ color: '#b91c1c', fontSize: 13, margin: '4px 0 0' }}>⚠ {err}</p>}

              <button style={{ ...S.btn, opacity: busy ? .6 : 1 }} disabled={busy} onClick={submit}>
                {busy ? 'Envoi…' : 'Envoyer le réquisitoire'}
              </button>
              <p style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', margin: '12px 0 0' }}>
                Transmission sécurisée · Verviers Dépannage SA · fourriere@verviersdepannage.be
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ k, v, strong }: { k: string; v: string | null; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: '1px solid #eef1f5' }}>
      <span style={{ color: '#94a3b8', fontSize: 13 }}>{k}</span>
      <span style={{ color: '#0b1120', fontSize: 14, fontWeight: strong ? 700 : 500, textAlign: 'right' }}>{v || '—'}</span>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: { minHeight: '100vh', background: '#f0f2f5', display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    padding: '24px 16px', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif' },
  card: { width: '100%', maxWidth: 520, background: '#fff', borderRadius: 14, overflow: 'hidden', boxShadow: '0 4px 24px rgba(15,23,42,.1)' },
  header: { background: '#CC2222', color: '#fff', padding: '20px 28px' },
  body: { padding: '28px' },
  h1: { fontSize: 22, fontWeight: 800, color: '#0b1120', margin: '0 0 8px' },
  muted: { fontSize: 14, color: '#64748b', lineHeight: 1.55, margin: '0 0 20px' },
  info: { background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 12, padding: '4px 16px', margin: '0 0 20px' },
  drop: { display: 'block', border: '2px dashed #cbd5e1', borderRadius: 12, padding: '20px 16px', textAlign: 'center',
    cursor: 'pointer', fontSize: 14, marginBottom: 12, background: '#fff' },
  textarea: { width: '100%', boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 10, padding: '10px 12px', fontSize: 14, resize: 'vertical' as any },
  btn: { width: '100%', marginTop: 16, background: '#CC2222', color: '#fff', border: 'none', borderRadius: 10,
    padding: '14px', fontSize: 15, fontWeight: 700, cursor: 'pointer' },
}
