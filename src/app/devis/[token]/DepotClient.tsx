'use client'
// src/app/devis/[token]/DepotClient.tsx
//
// Page PUBLIQUE de dépôt d'offre (appel d'offre). Le fournisseur dépose son devis
// (PDF, extrait par l'IA) ou saisit un montant. Aucune authentification (token).

import { useEffect, useRef, useState } from 'react'

export default function DepotClient({ token }: { token: string }) {
  const [info, setInfo] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [manual, setManual] = useState({ total_htva: '', delivery_days: '', payment_terms: '', note: '' })
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch(`/api/devis/${token}`, { cache: 'no-store' }).then(r => r.json())
      .then(d => { if (d.error) setErr(d.error); else { setInfo(d); if (d.responded) setDone(true) } })
      .finally(() => setLoading(false))
  }, [token])

  const submit = async (payload: any) => {
    setSending(true); setErr('')
    try {
      const r = await fetch(`/api/devis/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const j = await r.json()
      if (!r.ok) { setErr(j.error || 'Erreur'); return }
      setDone(true)
    } catch { setErr('Erreur réseau') } finally { setSending(false) }
  }

  const onFile = async (file: File) => {
    const b64 = await new Promise<string>((res, rej) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result).split(',')[1] || ''); rd.onerror = rej; rd.readAsDataURL(file) })
    submit({ file_b64: b64, filename: file.name, mimetype: file.type || 'application/pdf' })
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f12', color: '#eee', fontFamily: '-apple-system,Segoe UI,Arial,sans-serif', padding: '32px 16px' }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#CC2222,#7a1414)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>VD</div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>Verviers Dépannage — Demande de devis</div>
        </div>

        {loading && <p style={{ color: '#999' }}>Chargement…</p>}
        {err && !info && <div style={{ background: '#3a1414', border: '1px solid #7a1414', borderRadius: 12, padding: 16 }}>{err}</div>}

        {info && (
          <div style={{ background: '#17171c', border: '1px solid #2a2a30', borderRadius: 20, padding: 24 }}>
            <div style={{ fontSize: 13, letterSpacing: 1.5, color: '#CC5555', fontWeight: 700 }}>VOTRE OFFRE</div>
            <h1 style={{ fontSize: 22, margin: '6px 0 4px', color: '#fff' }}>{info.label}</h1>
            {info.spec && <p style={{ color: '#a0a0aa', fontSize: 14, marginTop: 4, whiteSpace: 'pre-wrap' }}>{info.spec}</p>}

            {done ? (
              <div style={{ marginTop: 20, background: '#10231a', border: '1px solid #1f7a4a', borderRadius: 14, padding: 20, textAlign: 'center' }}>
                <div style={{ fontSize: 32 }}>✅</div>
                <p style={{ color: '#fff', fontWeight: 600, marginTop: 6 }}>Merci, votre offre a bien été reçue.</p>
                <p style={{ color: '#8a8a92', fontSize: 13 }}>Nous revenons vers vous rapidement.</p>
              </div>
            ) : (
              <>
                <div style={{ marginTop: 22, border: '1px dashed #3a3a42', borderRadius: 14, padding: 20, textAlign: 'center' }}>
                  <p style={{ color: '#c0c0c8', fontSize: 14, margin: '0 0 12px' }}>Déposez votre devis (PDF) — l'idéal :</p>
                  <input ref={fileRef} type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
                  <button onClick={() => fileRef.current?.click()} disabled={sending}
                    style={{ background: '#CC2222', color: '#fff', border: 'none', fontWeight: 600, fontSize: 15, padding: '12px 28px', borderRadius: 12, cursor: 'pointer' }}>
                    {sending ? 'Envoi…' : '📎 Joindre mon devis PDF'}
                  </button>
                </div>

                <div style={{ textAlign: 'center', color: '#666', fontSize: 12, margin: '16px 0' }}>— ou saisissez votre prix —</div>

                <div style={{ display: 'grid', gap: 10 }}>
                  <input placeholder="Montant total HTVA (€)" value={manual.total_htva} onChange={e => setManual({ ...manual, total_htva: e.target.value })} style={inp} />
                  <div style={{ display: 'flex', gap: 10 }}>
                    <input placeholder="Délai (jours)" value={manual.delivery_days} onChange={e => setManual({ ...manual, delivery_days: e.target.value })} style={{ ...inp, flex: 1 }} />
                    <input placeholder="Conditions de paiement" value={manual.payment_terms} onChange={e => setManual({ ...manual, payment_terms: e.target.value })} style={{ ...inp, flex: 1 }} />
                  </div>
                  <textarea placeholder="Remarque (optionnel)" value={manual.note} onChange={e => setManual({ ...manual, note: e.target.value })} rows={2} style={{ ...inp, resize: 'none' }} />
                  <button onClick={() => submit(manual)} disabled={sending || !manual.total_htva.trim()}
                    style={{ background: manual.total_htva.trim() ? '#CC2222' : '#33333a', color: '#fff', border: 'none', fontWeight: 600, fontSize: 15, padding: '12px', borderRadius: 12, cursor: 'pointer' }}>
                    {sending ? 'Envoi…' : 'Envoyer mon offre'}
                  </button>
                </div>
                {err && <p style={{ color: '#e88', fontSize: 13, marginTop: 10 }}>{err}</p>}
              </>
            )}
          </div>
        )}
        <p style={{ textAlign: 'center', color: '#55555c', fontSize: 11, marginTop: 20 }}>Verviers Dépannage · demande de prix</p>
      </div>
    </div>
  )
}

const inp: React.CSSProperties = { background: '#0f0f12', border: '1px solid #2a2a30', borderRadius: 10, padding: '11px 14px', color: '#eee', fontSize: 14, width: '100%', boxSizing: 'border-box' }
